import { Worker } from 'bullmq'
import { getDb } from '@aigc/db'
import { sql } from 'kysely'
import type { MusicJobData, MusicModel, MusicTrackStatus } from '@aigc/types'
import { getBullMQConnection, getPubRedis } from '../lib/redis.js'
import { buildLogger } from '../logger.js'
import { MurekaClient, type MurekaMediaResult } from '../lib/mureka.js'
import { transferMusicUrl } from '../lib/music-storage.js'
import { VolcengineImageAdapter } from '../adapters/volcengine-image.js'
import {
  buildCoverPrompt,
  nextTrackStatusForMode,
  parseMusicBatchParams,
  pickFinalMediaResult,
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
      description: 'Music generation confirmed',
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
      description: `Music generation failed: ${message.slice(0, 200)}`,
    }).execute()

    await trx.updateTable('task_batches').set({
      failed_count: sql`failed_count + 1`,
      status: 'failed',
    }).where('id', '=', data.batchId).execute()
  })
  await publishTrackEvent(data.trackId, { event: 'failed', error_message: message })
}

async function generateCover(track: { id: string; title: string; prompt: string | null; lyrics: string | null; styles: string[]; type: 'song' | 'instrumental' }) {
  try {
    await updateTrackStatus(track.id, 'cover_generating')
    const adapter = new VolcengineImageAdapter()
    const result = await adapter.generateImage({
      model: 'seedream-5.0-lite',
      prompt: buildCoverPrompt(track),
      params: { aspect_ratio: '1:1', resolution: '2k', watermark: false },
    })
    if (!result.success || !result.outputUrl) throw new Error(result.errorMessage ?? '封面生成失败')
    const stored = await transferMusicUrl(result.outputUrl, 'cover', track.id, { maxBytes: 20 * 1024 * 1024 })
    await getDb().updateTable('music_tracks').set({
      cover_url: result.outputUrl,
      cover_storage_url: stored.storageUrl,
    }).where('id', '=', track.id).execute()
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
  const [audio, flac, wav] = await Promise.all([
    result.url ? transferMusicUrl(result.url, 'audio', trackId) : Promise.resolve(null),
    result.flac_url ? transferMusicUrl(result.flac_url, 'flac', trackId) : Promise.resolve(null),
    result.wav_url ? transferMusicUrl(result.wav_url, 'wav', trackId) : Promise.resolve(null),
  ])
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
      const mureka = new MurekaClient()
      const model = row.model as MusicModel
      const initialStatus = nextTrackStatusForMode(row.mode, row.type)
      await updateTrackStatus(row.id, initialStatus)

      let lyrics = row.lyrics
      if (row.mode === 'inspiration' && row.type === 'song') {
        lyrics = await mureka.generateLyrics({
          prompt: row.prompt ?? '',
          model,
          voiceGender: row.voice_gender,
        })
        await db.updateTable('music_tracks').set({ lyrics }).where('id', '=', row.id).execute()
        await publishTrackEvent(row.id, { event: 'lyrics_delta', delta: lyrics, lyrics })
      }

      await updateTrackStatus(row.id, 'song_generating')
      const immediate = row.type === 'instrumental'
        ? await mureka.generateInstrumental({ prompt: row.prompt ?? '', model, voiceGender: row.voice_gender })
        : await mureka.generateSong({
            lyrics: lyrics ?? '',
            prompt: row.prompt,
            title: row.title,
            model,
            voiceId: params.voice_id ?? null,
            voiceGender: row.voice_gender,
            styles: row.styles,
          })

      let media = pickFinalMediaResult(immediate)
      if (!media.url && !media.flac_url && !media.wav_url && media.task_id) {
        media = await mureka.pollSongResult(media.task_id)
      }
      if (media.stream_url) await publishTrackEvent(row.id, { event: 'stream_url', stream_url: media.stream_url })

      await generateCover({
        id: row.id,
        title: media.title ?? row.title ?? 'Toby AI 音乐',
        prompt: row.prompt,
        lyrics,
        styles: row.styles,
        type: row.type,
      })

      const stored = await transferResultMedia(row.id, media)
      await db.updateTable('music_tracks').set({
        title: media.title ?? row.title ?? 'Toby AI 音乐',
        lyrics,
        stream_url: media.stream_url ?? null,
        audio_url: media.url ?? null,
        audio_storage_url: stored.audioStorageUrl,
        flac_url: media.flac_url ?? null,
        flac_storage_url: stored.flacStorageUrl,
        wav_url: media.wav_url ?? null,
        wav_storage_url: stored.wavStorageUrl,
        external_task_id: media.task_id ?? media.id ?? null,
        status: 'completed',
      }).where('id', '=', row.id).execute()

      await confirmMusicCredits(data, data.estimatedCredits)
      await publishTrackEvent(row.id, { event: 'completed', track_id: row.id })
      logger.info(logCtx, '音乐生成任务完成')
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
