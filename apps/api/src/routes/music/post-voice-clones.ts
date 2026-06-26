import type { FastifyBaseLogger, FastifyPluginAsync } from 'fastify'
import { randomUUID } from 'node:crypto'
import { getDb } from '@aigc/db'
import type { MusicVoiceCloneJobData } from '@aigc/types'
import { deleteTosObject, extractStorageKey, uploadToTos } from '../../lib/storage.js'
import { getMusicVoiceCloneQueue } from '../../lib/queue.js'
import { deductBizMgmtPointsForGeneration } from '../../services/biz-mgmt-a-bean.js'
import {
  assertWorkspaceAccess,
  getExpectedCreditErrorMessage,
  markMusicQueueDeliveryFailed,
  mapMusicVoiceCloneResponse,
  MAX_VOICE_CLONE_AUDIO_SIZE,
  MUSIC_QUEUE_DELIVERY_ERROR_MESSAGE,
  resolveVoiceCloneCredits,
  sendMusicRouteError,
  assertVoiceCloneAudioDuration,
  validateVoiceCloneAudioUpload,
  validateVoiceClonePayload,
} from './_shared.js'

function isPayloadTooLargeError(error: unknown): boolean {
  return error instanceof Error && (
    (error as Error & { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE'
    || /file.*too large|request file too large/i.test(error.message)
  )
}

async function cleanupUploadedAudio(sourceAudioUrl: string | null, logger: Pick<FastifyBaseLogger, 'error'>): Promise<void> {
  if (!sourceAudioUrl) return
  const key = extractStorageKey(sourceAudioUrl)
  if (!key) return
  try {
    await deleteTosObject(key)
  } catch (error) {
    logger.error({ err: error, sourceAudioUrl }, 'Failed to cleanup uploaded music voice clone source audio')
  }
}

const route: FastifyPluginAsync = async (app) => {
  app.post('/music/voice-clones', async (request, reply) => {
    const fields: Record<string, unknown> = {}
    let file: { filename: string; buffer: Buffer; contentType: string } | null = null

    try {
      const parts = (request as any).parts({ limits: { fileSize: MAX_VOICE_CLONE_AUDIO_SIZE, files: 1 } })
      for await (const part of parts) {
        if (part.type === 'file') {
          if (file) {
            part.file.resume()
            return reply.status(400).send({
              success: false,
              error: { code: 'BAD_REQUEST', message: '只能上传一个音频文件' },
            })
          }

          const chunks: Buffer[] = []
          for await (const chunk of part.file) {
            chunks.push(chunk as Buffer)
          }
          const buffer = Buffer.concat(chunks)
          const validatedAudio = validateVoiceCloneAudioUpload(part.filename, buffer, part.mimetype)
          assertVoiceCloneAudioDuration(buffer, validatedAudio.ext)
          file = {
            filename: `${randomUUID()}.${validatedAudio.ext}`,
            buffer,
            contentType: validatedAudio.contentType,
          }
        } else if (part.fieldname) {
          fields[part.fieldname] = part.value
        }
      }
    } catch (error) {
      app.log.warn({ err: error }, 'Failed to parse music voice clone multipart payload')
      if (isPayloadTooLargeError(error)) {
        return reply.status(413).send({
          success: false,
          error: { code: 'PAYLOAD_TOO_LARGE', message: '音频文件过大，最大支持 10 MB' },
        })
      }
      if (error instanceof Error && error.name === 'MusicRouteError') {
        return sendMusicRouteError(reply, error, app.log, 'Music voice clone audio validation failed')
      }
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
      const credits = await resolveVoiceCloneCredits(db, access.teamId)
      let sourceAudioUrl: string | null = null

      try {
        sourceAudioUrl = await uploadToTos(`uploads/music/voice-clones/${file.filename}`, file.buffer, file.contentType)
      } catch (error) {
        app.log.error({ err: error }, 'Failed to upload music voice clone source audio')
        return reply.status(500).send({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: '音频上传失败，请稍后重试' },
        })
      }
      const uploadedAudioUrl = sourceAudioUrl

      // 业管 A 豆扣减（所有用户统一走业管：实时余额校验 → 扣减 → 成功后才创建任务）
      // idempotency_key 提前生成，用作扣减幂等号 + batch 幂等键，保证稳定可追溯
      const voiceCloneIdempotencyKey = randomUUID()
      let bizMgmtBilling: { requestNo: string; bizMgmtUserId: string; workNo: string }
      try {
        const deduction = await deductBizMgmtPointsForGeneration({
          localUserId: userId,
          teamId: access.teamId,
          workspaceId,
          batchId: voiceCloneIdempotencyKey,
          pointsNum: credits.estimatedCredits,
          source: 1,
          remark: `音色克隆：${payload.name}`,
        })
        bizMgmtBilling = deduction
      } catch (error) {
        const message = getExpectedCreditErrorMessage(error)
        await cleanupUploadedAudio(sourceAudioUrl, app.log)
        if (!message) {
          app.log.error({ err: error }, 'Failed to deduct a beans for music voice clone')
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

      let created: { batch: any; task: any; voiceClone: any } | null = null
      try {
        created = await db.transaction().execute(async (trx: any) => {
          const batch = await trx
            .insertInto('task_batches')
            .values({
              user_id: userId,
              team_id: access.teamId,
              workspace_id: workspaceId,
              idempotency_key: voiceCloneIdempotencyKey,
              source: 'studio',
              module: 'music_voice_clone',
              provider: credits.providerCode,
              model: 'voice_clone',
              prompt: payload.name,
              params: JSON.stringify({
                name: payload.name,
                description: payload.description,
                gender: payload.gender,
                source_audio_url: uploadedAudioUrl,
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
              source_audio_url: uploadedAudioUrl,
              source_audio_storage_url: uploadedAudioUrl,
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
          estimatedCredits: credits.estimatedCredits,
          // 业管计费上下文，供 worker 终态写创作结果 outbox
          bizMgmtDeductRequestNo: bizMgmtBilling.requestNo,
          bizMgmtUserId: bizMgmtBilling.bizMgmtUserId,
          bizMgmtWorkNo: bizMgmtBilling.workNo,
        }
        await getMusicVoiceCloneQueue().add('music-voice-clone', jobData)
      } catch (error) {
        app.log.error({ err: error }, 'Failed to create music voice clone task')
        if (created) {
          try {
            await markMusicQueueDeliveryFailed(db, {
              batchId: created.batch.id,
              taskId: created.task.id,
              voiceCloneId: created.voiceClone.id,
              errorMessage: MUSIC_QUEUE_DELIVERY_ERROR_MESSAGE,
            })
          } catch (markError) {
            app.log.error({ err: markError }, 'Failed to mark music voice clone task as failed after queue delivery failure')
          }
        }
        await cleanupUploadedAudio(sourceAudioUrl, app.log)
        // 业管扣减已完成，本地不再退积分；由 biz_mgmt_a_bean_transactions 审计 + 人工对账
        return reply.status(500).send({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: '任务创建失败，请稍后重试' },
        })
      }

      return reply.status(201).send(await mapMusicVoiceCloneResponse(created.voiceClone))
    } catch (error) {
      return sendMusicRouteError(reply, error, app.log, 'Music voice clone request failed')
    }
  })
}

export default route
