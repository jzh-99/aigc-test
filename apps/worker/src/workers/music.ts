import { Worker } from 'bullmq'
import { getDb, recordProviderApiLog } from '@aigc/db'
import { sql } from 'kysely'
import { ErrorCode } from '@aigc/types'
import type { MusicJobData, MusicModel, MusicTrackStatus } from '@aigc/types'
import { getBullMQConnection, getPubRedis } from '../lib/redis.js'
import { buildLogger } from '../logger.js'
import { MurekaClient, type MurekaMediaResult } from '../lib/mureka.js'
import { transferMusicUrl } from '../lib/music-storage.js'
import { VolcengineImageAdapter } from '../adapters/volcengine-image.js'
import { dispatchBatchResult } from '../lib/dispatch-result.js'
import {
  buildCoverPrompt,
  buildMurekaGenerationPrompt,
  hasMurekaDownloadableMediaUrl,
  hasMurekaMediaUrl,
  nextTrackStatusForMode,
  normalizeMurekaLyricsSections,
  parseMusicBatchParams,
  pickFinalMediaResult,
  resolveMurekaPollTaskId,
  shouldUseMurekaVoiceOptions,
} from './music-helpers.js'

const logger = buildLogger()

async function publishTrackEvent(trackId: string, payload: Record<string, unknown>): Promise<void> {
  try {
    await getPubRedis().publish(`sse:music_track:${trackId}`, JSON.stringify(payload))
  } catch (error) {
    logger.warn({ err: error, trackId }, '音乐 SSE 发布失败')
  }
}

async function updateTrackStatus(trackId: string, status: MusicTrackStatus, message?: string): Promise<void> {
  await getDb().updateTable('music_tracks').set({ status }).where('id', '=', trackId).execute()
  await publishTrackEvent(trackId, { event: 'status', status, message })
  logger.info({ trackId, status, message }, '音乐生成状态已更新')
}

async function updateTrackStreamUrl(trackId: string, streamUrl: string | null | undefined): Promise<void> {
  if (!streamUrl) return
  await getDb().updateTable('music_tracks').set({ stream_url: streamUrl }).where('id', '=', trackId).execute()
  await publishTrackEvent(trackId, { event: 'stream_url', stream_url: streamUrl })
  logger.info({ trackId, hasStreamUrl: true }, '音乐流式播放地址已提前写入')
}

async function confirmMusicCredits(data: MusicJobData, actualCredits: number): Promise<void> {
  const db = getDb()
  const now = new Date().toISOString()
  await db.transaction().execute(async (trx: any) => {
    await trx.updateTable('credit_accounts').set({
      frozen_credits: sql`GREATEST(frozen_credits - ${data.estimatedCredits}, 0)`,
      balance: sql`balance - ${actualCredits}`,
      total_spent: sql`total_spent + ${actualCredits}`,
    }).where('id', '=', data.creditAccountId).execute()

    if (actualCredits !== data.estimatedCredits) {
      await trx.updateTable('team_members').set({
        credit_used: sql`GREATEST(credit_used + ${actualCredits - data.estimatedCredits}, 0)`,
      }).where('team_id', '=', data.teamId).where('user_id', '=', data.userId).execute()
    }

    await trx.insertInto('credits_ledger').values({
      credit_account_id: data.creditAccountId,
      user_id: data.userId,
      amount: -actualCredits,
      type: 'confirm',
      task_id: data.taskId,
      batch_id: data.batchId,
      description: '音乐生成成功',
    }).execute()

    await trx.updateTable('tasks').set({
      status: 'completed',
      credits_cost: actualCredits,
      completed_at: now,
    }).where('id', '=', data.taskId).where('status', '!=', 'completed').where('status', '!=', 'failed').execute()

    await trx.updateTable('task_batches').set({
      completed_count: sql`completed_count + 1`,
      actual_credits: sql`actual_credits + ${actualCredits}`,
      status: 'completed',
    }).where('id', '=', data.batchId).execute()
  })
  logger.info({
    taskId: data.taskId,
    batchId: data.batchId,
    trackId: data.trackId,
    creditAccountId: data.creditAccountId,
    estimatedCredits: data.estimatedCredits,
    actualCredits,
  }, '音乐生成积分已确认')
}

async function failMusicJob(data: MusicJobData, message: string): Promise<void> {
  const db = getDb()
  const now = new Date().toISOString()
  await db.transaction().execute(async (trx: any) => {
    const locked = await sql<{ status: string }>`SELECT status FROM tasks WHERE id = ${data.taskId} FOR UPDATE`.execute(trx)
    const current = locked.rows[0]?.status
    if (current === 'completed' || current === 'failed') return

    await trx.updateTable('music_tracks').set({
      status: 'failed',
      error_message: message.slice(0, 1000),
    }).where('id', '=', data.trackId).execute()

    await trx.updateTable('tasks').set({
      status: 'failed',
      error_message: message.slice(0, 1000),
      completed_at: now,
    }).where('id', '=', data.taskId).execute()

    await trx.updateTable('credit_accounts').set({
      frozen_credits: sql`GREATEST(frozen_credits - ${data.estimatedCredits}, 0)`,
    }).where('id', '=', data.creditAccountId).execute()

    await trx.updateTable('team_members').set({
      credit_used: sql`GREATEST(credit_used - ${data.estimatedCredits}, 0)`,
    }).where('team_id', '=', data.teamId).where('user_id', '=', data.userId).execute()

    await trx.insertInto('credits_ledger').values({
      credit_account_id: data.creditAccountId,
      user_id: data.userId,
      amount: data.estimatedCredits,
      type: 'refund',
      task_id: data.taskId,
      batch_id: data.batchId,
      description: `音乐生成失败：${message.slice(0, 200)}`,
    }).execute()

    await trx.updateTable('task_batches').set({
      failed_count: sql`failed_count + 1`,
      status: 'failed',
    }).where('id', '=', data.batchId).execute()
  })
  await publishTrackEvent(data.trackId, { event: 'failed', error_message: message })

  // 开放接口分流：source='open_api' 走失败回调（HMAC POST callback_url），
  // 非 open_api 保持原 SSE（上面 publishTrackEvent 已发 sse:music_track:<id>）。
  const oaFail = await db.selectFrom('task_batches')
    .select(['callback_url', 'business_id', 'service_type', 'task_id', 'source'])
    .where('id', '=', data.batchId)
    .executeTakeFirst()
  if (oaFail?.source === 'open_api') {
    try {
      await dispatchBatchResult({
        batchId: data.batchId,
        status: 'failed',
        serviceType: oaFail.service_type ?? 'song',
        media: {},
        businessId: oaFail.business_id ?? '',
        taskId: oaFail.task_id ?? '',
        callbackUrl: oaFail.callback_url,
        failureCode: ErrorCode.EXTERNAL_SERVICE_FAILED,
      })
    } catch (cbErr) {
      logger.warn({
        taskId: data.taskId,
        batchId: data.batchId,
        err: cbErr instanceof Error ? cbErr.message : String(cbErr),
      }, '音乐生成失败后开放接口回调入队失败')
    }
  }
  logger.info({
    taskId: data.taskId,
    batchId: data.batchId,
    trackId: data.trackId,
    creditAccountId: data.creditAccountId,
    estimatedCredits: data.estimatedCredits,
    err: message,
  }, '音乐生成失败已落库并退回冻结积分')
}

async function generateCover(track: {
  id: string
  batchId: string
  taskId: string
  userId: string
  teamId: string
  workspaceId: string
  title: string
  prompt: string | null
  lyrics: string | null
  styles: string[]
  type: 'song' | 'instrumental'
}) {
  try {
    await updateTrackStatus(track.id, 'cover_generating')
    logger.info({
      trackId: track.id,
      trackType: track.type,
      titleLength: [...track.title].length,
      promptLength: track.prompt ? [...track.prompt].length : 0,
      lyricsLength: track.lyrics ? [...track.lyrics].length : 0,
      stylesCount: track.styles.length,
    }, '开始生成音乐封面')
    const adapter = new VolcengineImageAdapter()
    const coverRequest = {
      model: 'seedream-5.0-lite',
      prompt: buildCoverPrompt(track),
      params: { aspect_ratio: '1:1', resolution: '2k', watermark: false },
    }
    const startedAt = Date.now()
    const result = await adapter.generateImage(coverRequest)
    await recordProviderApiLog({
      batchId: track.batchId,
      taskId: track.taskId,
      userId: track.userId,
      teamId: track.teamId,
      workspaceId: track.workspaceId,
      module: 'music',
      provider: 'volcengine',
      model: coverRequest.model,
      operation: 'cover.generate',
      method: 'POST',
      endpoint: '/images/generations',
      requestPayload: result.requestPayload ?? coverRequest,
      responsePayload: result,
      durationMs: Date.now() - startedAt,
      status: result.success ? 'success' : 'failed',
      errorMessage: result.success ? null : result.errorMessage ?? '封面生成失败',
    })
    if (!result.success || !result.outputUrl) throw new Error(result.errorMessage ?? '封面生成失败')
    logger.info({ trackId: track.id, hasOutputUrl: Boolean(result.outputUrl) }, '音乐封面生成成功，开始转存')
    const stored = await transferMusicUrl(result.outputUrl, 'cover', track.id, { maxBytes: 20 * 1024 * 1024 })
    await getDb().updateTable('music_tracks').set({
      cover_url: result.outputUrl,
      cover_storage_url: stored.storageUrl,
    }).where('id', '=', track.id).execute()
    logger.info({ trackId: track.id, coverStorageUrl: stored.storageUrl }, '音乐封面已转存')
  } catch (error) {
    logger.warn({ err: error, trackId: track.id }, '歌曲封面生成失败，继续完成音乐任务')
  }
}

async function transferResultMedia(trackId: string, result: MurekaMediaResult): Promise<{
  audioStorageUrl: string | null
  flacStorageUrl: string | null
  wavStorageUrl: string | null
}> {
  await updateTrackStatus(trackId, 'transferring')
  logger.info({
    trackId,
    hasAudioUrl: Boolean(result.url),
    hasFlacUrl: Boolean(result.flac_url),
    hasWavUrl: Boolean(result.wav_url),
    hasStreamUrl: Boolean(result.stream_url),
    murekaTaskId: result.task_id ?? null,
    murekaId: result.id ?? null,
  }, '开始转存音乐生成结果')
  const [audio, flac, wav] = await Promise.all([
    result.url ? transferMusicUrl(result.url, 'audio', trackId) : Promise.resolve(null),
    result.flac_url ? transferMusicUrl(result.flac_url, 'flac', trackId) : Promise.resolve(null),
    result.wav_url ? transferMusicUrl(result.wav_url, 'wav', trackId) : Promise.resolve(null),
  ])
  logger.info({
    trackId,
    audioStorageUrl: audio?.storageUrl ?? null,
    flacStorageUrl: flac?.storageUrl ?? null,
    wavStorageUrl: wav?.storageUrl ?? null,
  }, '音乐生成结果转存完成')
  return {
    audioStorageUrl: audio?.storageUrl ?? null,
    flacStorageUrl: flac?.storageUrl ?? null,
    wavStorageUrl: wav?.storageUrl ?? null,
  }
}

export const musicWorker = new Worker<MusicJobData>(
  'music-queue',
  async (job) => {
    const data = job.data
    const db = getDb()
    const logCtx = { jobId: job.id, taskId: data.taskId, trackId: data.trackId }
    logger.info(logCtx, '开始处理音乐生成任务')

    await db.updateTable('tasks').set({
      status: 'processing',
      processing_started_at: new Date().toISOString(),
      queue_job_id: job.id ?? null,
    }).where('id', '=', data.taskId).execute()
    await db.updateTable('task_batches').set({ status: 'processing' }).where('id', '=', data.batchId).where('status', '=', 'pending').execute()

    try {
      const row = await db
        .selectFrom('music_tracks as mt')
        .innerJoin('task_batches as tb', 'tb.id', 'mt.batch_id')
        .selectAll('mt')
        .select(['tb.params as batch_params'])
        .where('mt.id', '=', data.trackId)
        .executeTakeFirstOrThrow()

      const params = parseMusicBatchParams(row.batch_params)
      const mureka = new MurekaClient({
        auditContext: {
          batchId: data.batchId,
          taskId: data.taskId,
          userId: data.userId,
          teamId: data.teamId,
          workspaceId: data.workspaceId,
          module: 'music',
        },
      })
      const model = row.model as MusicModel
      const initialStatus = nextTrackStatusForMode(row.mode, row.type)
      const musicCtx = {
        ...logCtx,
        batchId: data.batchId,
        userId: data.userId,
        teamId: data.teamId,
        workspaceId: data.workspaceId,
        mode: row.mode,
        trackType: row.type,
        model,
        voiceGender: row.voice_gender,
        hasVoiceClone: Boolean(row.voice_clone_id),
        hasResolvedVoiceId: Boolean(params.voice_id),
        stylesCount: row.styles.length,
        promptLength: row.prompt ? [...row.prompt].length : 0,
        lyricsLength: row.lyrics ? [...row.lyrics].length : 0,
        titleLength: row.title ? [...row.title].length : 0,
        estimatedCredits: data.estimatedCredits,
      }
      logger.info(musicCtx, '音乐生成任务上下文已加载')
      await updateTrackStatus(row.id, initialStatus)
      const generationPrompt = buildMurekaGenerationPrompt({
        mode: row.mode,
        type: row.type,
        title: row.title,
        prompt: row.prompt,
        lyrics: row.lyrics,
        styles: row.styles,
        voiceGender: row.voice_gender,
      })

      let lyrics = row.lyrics
      let generatedTitle = row.title
      if (row.mode === 'inspiration' && row.type === 'song') {
        logger.info(musicCtx, '开始调用 Mureka 生成歌词')
        const lyricsResult = await mureka.generateLyrics({
          prompt: generationPrompt,
          model,
        })
        lyrics = lyricsResult.lyrics
        generatedTitle = lyricsResult.title ?? row.title
        logger.info({
          ...musicCtx,
          generatedLyricsLength: lyrics ? [...lyrics].length : 0,
          generatedTitleLength: generatedTitle ? [...generatedTitle].length : 0,
        }, 'Mureka 歌词生成完成')
        await db.updateTable('music_tracks').set({ title: generatedTitle, lyrics }).where('id', '=', row.id).execute()
        await publishTrackEvent(row.id, { event: 'lyrics_delta', delta: lyrics, lyrics })
      }

      await updateTrackStatus(row.id, 'song_generating')
      logger.info({
        ...musicCtx,
        lyricsLengthForSong: lyrics ? [...lyrics].length : 0,
      }, row.type === 'instrumental' ? '开始调用 Mureka 生成纯音乐' : '开始调用 Mureka 生成歌曲')
      const shouldUseVoiceOptions = shouldUseMurekaVoiceOptions(row.type)
      const immediate = row.type === 'instrumental'
        ? await mureka.generateInstrumental({ prompt: generationPrompt, model })
        : await mureka.generateSong({
            lyrics: lyrics ?? '',
            prompt: generationPrompt,
            title: generatedTitle,
            model,
            voiceId: shouldUseVoiceOptions ? params.voice_id ?? null : null,
            styles: row.styles,
          })

      logger.info({
        ...musicCtx,
        murekaTaskId: immediate.task_id ?? null,
        murekaId: immediate.id ?? null,
        murekaStatus: immediate.status ?? null,
        hasAudioUrl: Boolean(immediate.url),
        hasFlacUrl: Boolean(immediate.flac_url),
        hasWavUrl: Boolean(immediate.wav_url),
        hasStreamUrl: Boolean(immediate.stream_url),
      }, 'Mureka 音乐生成初始响应')
      let media = pickFinalMediaResult(immediate)
      await updateTrackStreamUrl(row.id, media.stream_url)
      const initialPollTaskId = resolveMurekaPollTaskId(media)
      if (!hasMurekaDownloadableMediaUrl(media) && initialPollTaskId) {
        logger.info({ ...musicCtx, murekaTaskId: initialPollTaskId }, 'Mureka 音乐生成进入轮询')
        let lastStreamUrl = media.stream_url ?? null
        const pollResult = row.type === 'instrumental'
          ? mureka.pollInstrumentalResult
          : mureka.pollSongResult
        media = await pollResult.call(mureka, initialPollTaskId, {
          onUpdate: async (result) => {
            if (result.stream_url && result.stream_url !== lastStreamUrl) {
              lastStreamUrl = result.stream_url
              await updateTrackStreamUrl(row.id, result.stream_url)
            }
          },
        })
        logger.info({
          ...musicCtx,
          murekaTaskId: resolveMurekaPollTaskId(media) ?? initialPollTaskId,
          murekaId: media.id ?? null,
          murekaStatus: media.status ?? null,
          hasAudioUrl: Boolean(media.url),
          hasFlacUrl: Boolean(media.flac_url),
          hasWavUrl: Boolean(media.wav_url),
          hasStreamUrl: Boolean(media.stream_url),
        }, 'Mureka 音乐生成轮询完成')
      }
      if (!hasMurekaMediaUrl(media)) {
        logger.warn({
          ...musicCtx,
          murekaTaskId: resolveMurekaPollTaskId(media) ?? initialPollTaskId,
          murekaId: media.id ?? immediate.id ?? null,
          murekaStatus: media.status ?? immediate.status ?? null,
        }, 'Mureka 音乐生成未返回可播放地址')
        throw new Error('Mureka 音乐生成未返回可播放地址')
      }
      await updateTrackStreamUrl(row.id, media.stream_url)

      await generateCover({
        id: row.id,
        batchId: data.batchId,
        taskId: data.taskId,
        userId: data.userId,
        teamId: data.teamId,
        workspaceId: data.workspaceId,
        title: media.title ?? generatedTitle ?? 'Toby AI 音乐',
        prompt: row.prompt,
        lyrics,
        styles: row.styles,
        type: row.type,
      })

      const stored = await transferResultMedia(row.id, media)
      await db.updateTable('music_tracks').set({
        title: media.title ?? generatedTitle ?? 'Toby AI 音乐',
        lyrics,
        stream_url: media.stream_url ?? null,
        audio_url: media.url ?? null,
        audio_storage_url: stored.audioStorageUrl,
        flac_url: media.flac_url ?? null,
        flac_storage_url: stored.flacStorageUrl,
        wav_url: media.wav_url ?? null,
        wav_storage_url: stored.wavStorageUrl,
        duration_seconds: media.duration ?? null,
        lyrics_sections: JSON.stringify(normalizeMurekaLyricsSections(media.lyrics_sections)),
        external_task_id: media.task_id ?? media.id ?? null,
        status: 'completed',
      }).where('id', '=', row.id).execute()

      await confirmMusicCredits(data, data.estimatedCredits)
      await publishTrackEvent(row.id, { event: 'completed', track_id: row.id })

      // 开放接口分流：source='open_api' 走最终回调（HMAC POST callback_url），
      // 非 open_api 保持原 SSE（publishTrackEvent 已发 sse:music_track:<id>）。
      // 查 task_batches 判定 source，并取回调契约字段。
      // media/extraMeta 对齐源 callbacks.py 的 _song_meta：
      //   music_url（音频永久 URL，优先 audio_storage_url 转存地址）
      //   image_url（封面永久 URL，cover_storage_url）
      //   title/duration/lyrics_sections（extra_meta）
      const oaRow = await db.selectFrom('task_batches')
        .select(['callback_url', 'business_id', 'service_type', 'task_id', 'source'])
        .where('id', '=', data.batchId)
        .executeTakeFirst()
      if (oaRow?.source === 'open_api') {
        // 重新查 music_tracks 取最终落库的 cover_storage_url/title/duration/lyrics_sections
        const finalTrack = await db.selectFrom('music_tracks')
          .select(['title', 'cover_storage_url', 'cover_url', 'audio_storage_url', 'audio_url', 'duration_seconds', 'lyrics_sections'])
          .where('id', '=', row.id)
          .executeTakeFirst()
        // 音频优先用转存后的永久地址（audio_storage_url），回退到供应商原始地址
        const musicUrl = finalTrack?.audio_storage_url ?? finalTrack?.audio_url ?? media.url ?? null
        // 封面优先用转存后的永久地址
        const imageUrl = finalTrack?.cover_storage_url ?? finalTrack?.cover_url ?? null
        await dispatchBatchResult({
          batchId: data.batchId,
          status: 'succeeded',
          serviceType: oaRow.service_type ?? 'song',
          media: {
            music_url: musicUrl,
            image_url: imageUrl,
          },
          extraMeta: {
            title: finalTrack?.title ?? media.title ?? generatedTitle ?? null,
            duration: finalTrack?.duration_seconds ?? media.duration ?? null,
            lyrics_sections: finalTrack?.lyrics_sections ?? normalizeMurekaLyricsSections(media.lyrics_sections),
          },
          businessId: oaRow.business_id ?? '',
          taskId: oaRow.task_id ?? '',
          callbackUrl: oaRow.callback_url,
        })
      }

      logger.info({
        ...musicCtx,
        murekaTaskId: media.task_id ?? media.id ?? null,
        completedTitleLength: media.title ? [...media.title].length : [...(row.title ?? 'Toby AI 音乐')].length,
        hasAudioStorageUrl: Boolean(stored.audioStorageUrl),
        hasFlacStorageUrl: Boolean(stored.flacStorageUrl),
        hasWavStorageUrl: Boolean(stored.wavStorageUrl),
        lyricsSectionsCount: media.lyrics_sections?.length ?? 0,
        durationSeconds: media.duration ?? null,
      }, '音乐生成任务完成')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error({ ...logCtx, err: message }, '音乐生成任务失败')
      await failMusicJob(data, message)
    }
  },
  {
    connection: getBullMQConnection(),
    concurrency: 3,
    lockDuration: 30 * 60_000,
  },
)

musicWorker.on('error', (err) => {
  logger.error({ err: err.message }, 'Music worker 错误')
})
