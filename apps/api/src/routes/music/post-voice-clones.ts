import type { FastifyPluginAsync } from 'fastify'
import { randomUUID } from 'node:crypto'
import { getDb } from '@aigc/db'
import type { MusicVoiceCloneJobData } from '@aigc/types'
import { uploadToTos } from '../../lib/storage.js'
import { freezeCredits, refundCredits } from '../../services/credit.js'
import { getMusicVoiceCloneQueue } from '../../lib/queue.js'
import {
  assertWorkspaceAccess,
  getExpectedCreditErrorMessage,
  mapMusicVoiceCloneResponse,
  resolveVoiceCloneCredits,
  sendMusicRouteError,
  validateVoiceClonePayload,
} from './_shared.js'

const MAX_AUDIO_SIZE = 50 * 1024 * 1024
const AUDIO_EXTS = ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg']
const AUDIO_MIME: Record<string, string> = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  flac: 'audio/flac',
  ogg: 'audio/ogg',
}

const route: FastifyPluginAsync = async (app) => {
  app.post('/music/voice-clones', async (request, reply) => {
    const fields: Record<string, unknown> = {}
    let file: { filename: string; buffer: Buffer; contentType: string } | null = null

    try {
      const parts = (request as any).parts({ limits: { fileSize: MAX_AUDIO_SIZE, files: 1 } })
      for await (const part of parts) {
        if (part.type === 'file') {
          if (file) {
            part.file.resume()
            return reply.status(400).send({
              success: false,
              error: { code: 'BAD_REQUEST', message: '只能上传一个音频文件' },
            })
          }

          const ext = String(part.filename ?? '').split('.').pop()?.toLowerCase() ?? ''
          if (!AUDIO_EXTS.includes(ext)) {
            part.file.resume()
            return reply.status(400).send({
              success: false,
              error: { code: 'BAD_REQUEST', message: `不支持的音频格式，请上传 ${AUDIO_EXTS.join('/')} 文件` },
            })
          }

          const chunks: Buffer[] = []
          for await (const chunk of part.file) {
            chunks.push(chunk as Buffer)
          }
          const buffer = Buffer.concat(chunks)
          if (buffer.length > MAX_AUDIO_SIZE) {
            return reply.status(413).send({
              success: false,
              error: { code: 'PAYLOAD_TOO_LARGE', message: '音频文件过大，最大支持 50 MB' },
            })
          }
          file = {
            filename: `${randomUUID()}.${ext}`,
            buffer,
            contentType: AUDIO_MIME[ext] ?? part.mimetype ?? 'application/octet-stream',
          }
        } else if (part.fieldname) {
          fields[part.fieldname] = part.value
        }
      }
    } catch (error) {
      app.log.warn({ err: error }, 'Failed to parse music voice clone multipart payload')
      return reply.status(400).send({
        success: false,
        error: { code: 'BAD_REQUEST', message: '上传表单解析失败' },
      })
    }

    if (!file) {
      return reply.status(400).send({
        success: false,
        error: { code: 'BAD_REQUEST', message: '请上传音频文件' },
      })
    }

    const workspaceId = typeof fields.workspace_id === 'string' ? fields.workspace_id.trim() : ''
    if (!workspaceId) {
      return reply.status(400).send({
        success: false,
        error: { code: 'BAD_REQUEST', message: 'workspace_id 不能为空' },
      })
    }

    let payload: ReturnType<typeof validateVoiceClonePayload>
    try {
      payload = validateVoiceClonePayload(fields)
    } catch (error) {
      return sendMusicRouteError(reply, error, app.log, 'Music voice clone validation failed')
    }

    const db = getDb()
    const userId = request.user.id

    try {
      const access = await assertWorkspaceAccess(db, workspaceId, userId, request.user.role)
      const credits = await resolveVoiceCloneCredits(db, access.teamId, payload.model)

      let sourceAudioUrl: string
      try {
        sourceAudioUrl = await uploadToTos(`uploads/music/voice-clones/${file.filename}`, file.buffer, file.contentType)
      } catch (error) {
        app.log.error({ err: error }, 'Failed to upload music voice clone source audio')
        return reply.status(500).send({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: '音频上传失败，请稍后重试' },
        })
      }

      let creditAccountId: string
      try {
        const frozen = await freezeCredits(access.teamId, userId, credits.estimatedCredits)
        creditAccountId = frozen.creditAccountId
      } catch (error) {
        const message = getExpectedCreditErrorMessage(error)
        if (!message) {
          app.log.error({ err: error }, 'Failed to freeze credits for music voice clone')
          return reply.status(500).send({
            success: false,
            error: { code: 'INTERNAL_ERROR', message: '请求处理失败，请稍后重试' },
          })
        }
        return reply.status(402).send({
          success: false,
          error: { code: 'INSUFFICIENT_CREDITS', message },
        })
      }

      let created: { batch: any; task: any; voiceClone: any }
      try {
        created = await db.transaction().execute(async (trx: any) => {
          const batch = await trx
            .insertInto('task_batches')
            .values({
              user_id: userId,
              team_id: access.teamId,
              workspace_id: workspaceId,
              credit_account_id: creditAccountId,
              idempotency_key: randomUUID(),
              module: 'music_voice_clone',
              provider: credits.providerCode,
              model: payload.model,
              prompt: payload.name,
              params: JSON.stringify({
                name: payload.name,
                description: payload.description,
                gender: payload.gender,
                source_audio_url: sourceAudioUrl,
                unit_prices: credits.unitPrices,
              }),
              quantity: 1,
              status: 'pending',
              estimated_credits: credits.estimatedCredits,
            })
            .returningAll()
            .executeTakeFirstOrThrow()

          const task = await trx
            .insertInto('tasks')
            .values({
              batch_id: batch.id,
              user_id: userId,
              version_index: 0,
              estimated_credits: credits.estimatedCredits,
              status: 'pending',
            })
            .returningAll()
            .executeTakeFirstOrThrow()

          const voiceClone = await trx
            .insertInto('music_voice_clones')
            .values({
              workspace_id: workspaceId,
              user_id: userId,
              team_id: access.teamId,
              batch_id: batch.id,
              task_id: task.id,
              name: payload.name,
              gender: payload.gender,
              description: payload.description,
              source_audio_url: sourceAudioUrl,
              source_audio_storage_url: sourceAudioUrl,
              voice_id: null,
              external_voice_id: null,
              external_task_id: null,
              status: 'pending',
            })
            .returningAll()
            .executeTakeFirstOrThrow()

          return { batch, task, voiceClone }
        })

        const jobData: MusicVoiceCloneJobData = {
          taskId: created.task.id,
          batchId: created.batch.id,
          voiceCloneId: created.voiceClone.id,
          userId,
          teamId: access.teamId,
          workspaceId,
          creditAccountId,
          estimatedCredits: credits.estimatedCredits,
        }
        await getMusicVoiceCloneQueue().add('music-voice-clone', jobData)
      } catch (error) {
        app.log.error({ err: error }, 'Failed to create music voice clone task')
        try {
          await refundCredits(access.teamId, creditAccountId, userId, credits.estimatedCredits)
        } catch (refundError) {
          app.log.error({ err: refundError }, 'Failed to refund music voice clone credits')
        }
        return reply.status(500).send({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: '任务创建失败，积分已退回，请重试' },
        })
      }

      return reply.status(201).send(await mapMusicVoiceCloneResponse(created.voiceClone))
    } catch (error) {
      return sendMusicRouteError(reply, error, app.log, 'Music voice clone request failed')
    }
  })
}

export default route
