import type { FastifyPluginAsync } from 'fastify'
import { randomUUID } from 'node:crypto'
import { getDb } from '@aigc/db'
import type { MusicJobData } from '@aigc/types'
import { getMusicQueue } from '../../lib/queue.js'
import { deductBizMgmtPointsForGeneration } from '../../services/biz-mgmt-a-bean.js'
import {
  assertVoiceCloneReadyForWorkspace,
  assertWorkspaceAccess,
  getExpectedCreditErrorMessage,
  markMusicQueueDeliveryFailed,
  mapMusicTrackResponse,
  MUSIC_QUEUE_DELIVERY_ERROR_MESSAGE,
  resolveMusicCredits,
  sendMusicRouteError,
  validateMusicGeneratePayload,
} from './_shared.js'

function deriveInitialMusicTitle(payload: ReturnType<typeof validateMusicGeneratePayload>): string {
  const source = payload.title ?? payload.prompt ?? payload.lyrics ?? 'Toby AI 音乐'
  return [...source.trim()].slice(0, 20).join('') || 'Toby AI 音乐'
}

function toTaskResponse(task: any) {
  return {
    id: task.id,
    version_index: task.version_index,
    status: task.status,
    estimated_credits: task.estimated_credits,
    credits_cost: task.credits_cost ?? null,
    error_message: task.error_message ?? null,
    processing_started_at: task.processing_started_at?.toISOString?.() ?? task.processing_started_at ?? null,
    completed_at: task.completed_at?.toISOString?.() ?? task.completed_at ?? null,
    asset: null,
  }
}

function musicGenerateLogContext(payload: ReturnType<typeof validateMusicGeneratePayload>, userId: string, idempotencyKey: string) {
  return {
    userId,
    workspaceId: payload.workspace_id,
    idempotencyKey,
    mode: payload.mode,
    trackType: payload.track_type,
    model: payload.model,
    hasPrompt: Boolean(payload.prompt?.trim()),
    promptLength: payload.prompt ? [...payload.prompt].length : 0,
    hasLyrics: Boolean(payload.lyrics?.trim()),
    lyricsLength: payload.lyrics ? [...payload.lyrics].length : 0,
    hasTitle: Boolean(payload.title?.trim()),
    stylesCount: payload.styles.length,
    voiceGender: payload.voice_gender,
    hasVoiceClone: Boolean(payload.voice_clone_id),
    canvasId: payload.canvas_id ?? null,
    canvasNodeId: payload.canvas_node_id ?? null,
  }
}

const route: FastifyPluginAsync = async (app) => {
  app.post('/music/generate', async (request, reply) => {
    let payload: ReturnType<typeof validateMusicGeneratePayload>
    try {
      payload = validateMusicGeneratePayload(request.body)
    } catch (error) {
      return sendMusicRouteError(reply, error, app.log, 'Music generate validation failed')
    }

    const db = getDb()
    const userId = request.user.id
    const idempotencyKey = payload.idempotency_key ?? randomUUID()
    const logCtx = musicGenerateLogContext(payload, userId, idempotencyKey)
    app.log.info(logCtx, 'Music generate request accepted')

    try {
      const access = await assertWorkspaceAccess(db, payload.workspace_id, userId, request.user.role)

      const existingBatch = await db
        .selectFrom('task_batches')
        .selectAll()
        .where('idempotency_key', '=', idempotencyKey)
        .where('user_id', '=', userId)
        .where('workspace_id', '=', payload.workspace_id)
        .where('module', '=', 'music')
        .where('is_deleted', '=', false)
        .executeTakeFirst()

      if (existingBatch) {
        app.log.info({ ...logCtx, batchId: existingBatch.id, batchStatus: existingBatch.status }, 'Music generate idempotency hit')
        const existing = await db
          .selectFrom('music_tracks as mt')
          .leftJoin('tasks as t', 't.id', 'mt.task_id')
          .leftJoin('music_voice_clones as mvc', 'mvc.id', 'mt.voice_clone_id')
          .selectAll('mt')
          .select([
            't.estimated_credits as estimated_credits',
            't.credits_cost as credits_cost',
            't.completed_at as completed_at',
            'mvc.name as voice_name',
          ])
          .where('mt.batch_id', '=', existingBatch.id)
          .where('mt.workspace_id', '=', payload.workspace_id)
          .orderBy('mt.created_at', 'asc')
          .executeTakeFirst()

        const tasks = await db
          .selectFrom('tasks')
          .selectAll()
          .where('batch_id', '=', existingBatch.id)
          .orderBy('version_index', 'asc')
          .execute()

        return reply.send({
          id: existingBatch.id,
          module: existingBatch.module,
          provider: existingBatch.provider,
          model: existingBatch.model,
          prompt: existingBatch.prompt,
          params: existingBatch.params,
          quantity: existingBatch.quantity,
          completed_count: existingBatch.completed_count,
          failed_count: existingBatch.failed_count,
          status: existingBatch.status,
          estimated_credits: existingBatch.estimated_credits,
          actual_credits: existingBatch.actual_credits,
          created_at: existingBatch.created_at.toISOString?.() ?? String(existingBatch.created_at),
          tasks: tasks.map(toTaskResponse),
          track: existing ? await mapMusicTrackResponse(existing, { name: existing.voice_name }) : null,
        })
      }

      const voice = await assertVoiceCloneReadyForWorkspace(db, payload.workspace_id, payload.voice_clone_id)
      const credits = await resolveMusicCredits(db, access.teamId, payload.model, payload.track_type, payload.mode)
      app.log.info({
        ...logCtx,
        teamId: access.teamId,
        provider: credits.providerCode,
        estimatedCredits: credits.estimatedCredits,
        unitPrices: credits.unitPrices,
        providerModelId: credits.providerModelId,
        resolvedVoiceId: voice?.voice_id ?? null,
      }, 'Music generate credits resolved')

      // 业管 A 豆扣减（所有用户统一走业管：实时余额校验 → 扣减 → 成功后才创建任务）
      let bizMgmtBilling: { requestNo: string; bizMgmtUserId: string; workNo: string }
      try {
        const deduction = await deductBizMgmtPointsForGeneration({
          localUserId: userId,
          teamId: access.teamId,
          workspaceId: payload.workspace_id,
          batchId: idempotencyKey,
          pointsNum: credits.estimatedCredits,
          source: 1,
          remark: `音乐生成：${payload.model}`,
        })
        bizMgmtBilling = deduction
        app.log.info({ ...logCtx, teamId: access.teamId, estimatedCredits: credits.estimatedCredits }, 'Music generate a beans deducted')
      } catch (error) {
        const message = getExpectedCreditErrorMessage(error)
        if (!message) {
          app.log.error({ err: error }, 'Failed to deduct a beans for music generation')
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

      let created: { batch: any; task: any; track: any } | null = null
      try {
        created = await db.transaction().execute(async (trx: any) => {
          const params = {
            mode: payload.mode,
            track_type: payload.track_type,
            title: payload.title,
            lyrics: payload.lyrics,
            styles: payload.styles,
            voice_gender: payload.voice_gender,
            voice_clone_id: payload.voice_clone_id,
            voice_id: voice?.voice_id ?? null,
            unit_prices: credits.unitPrices,
            ...payload.params,
          }

          const batch = await trx
            .insertInto('task_batches')
            .values({
              user_id: userId,
              team_id: access.teamId,
              workspace_id: payload.workspace_id,
              idempotency_key: idempotencyKey,
              source: 'studio',
              module: 'music',
              provider: credits.providerCode,
              model: payload.model,
              prompt: payload.prompt ?? payload.lyrics ?? payload.title ?? '',
              params: JSON.stringify(params),
              quantity: 1,
              status: 'pending',
              estimated_credits: credits.estimatedCredits,
              ...(payload.canvas_id ? { canvas_id: payload.canvas_id, canvas_node_id: payload.canvas_node_id ?? null } : {}),
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

          const track = await trx
            .insertInto('music_tracks')
            .values({
              workspace_id: payload.workspace_id,
              user_id: userId,
              team_id: access.teamId,
              batch_id: batch.id,
              task_id: task.id,
              type: payload.track_type,
              mode: payload.mode,
              title: deriveInitialMusicTitle(payload),
              prompt: payload.prompt,
              lyrics: payload.lyrics,
              styles: JSON.stringify(payload.styles),
              voice_clone_id: payload.voice_clone_id,
              voice_gender: payload.voice_gender,
              model: payload.model,
            })
            .returningAll()
            .executeTakeFirstOrThrow()

          return { batch, task, track }
        })

        const jobData: MusicJobData = {
          taskId: created.task.id,
          batchId: created.batch.id,
          trackId: created.track.id,
          userId,
          teamId: access.teamId,
          workspaceId: payload.workspace_id,
          estimatedCredits: credits.estimatedCredits,
          // 业管计费上下文，供 worker 终态写创作结果 outbox
          bizMgmtDeductRequestNo: bizMgmtBilling.requestNo,
          bizMgmtUserId: bizMgmtBilling.bizMgmtUserId,
          bizMgmtWorkNo: bizMgmtBilling.workNo,
        }
        await getMusicQueue().add('music-generate', jobData)
        app.log.info({
          ...logCtx,
          batchId: created.batch.id,
          taskId: created.task.id,
          trackId: created.track.id,
          estimatedCredits: credits.estimatedCredits,
        }, 'Music generate task queued')
      } catch (error) {
        app.log.error({ err: error }, 'Failed to create music task')
        if (created) {
          try {
            await markMusicQueueDeliveryFailed(db, {
              batchId: created.batch.id,
              taskId: created.task.id,
              trackId: created.track.id,
              errorMessage: MUSIC_QUEUE_DELIVERY_ERROR_MESSAGE,
            })
          } catch (markError) {
            app.log.error({ err: markError }, 'Failed to mark music task as failed after queue delivery failure')
          }
        }
        // 业管扣减已完成，本地不再退积分；由 biz_mgmt_a_bean_transactions 审计 + 人工对账
        return reply.status(500).send({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: '任务创建失败，请稍后重试' },
        })
      }

      const track = await mapMusicTrackResponse(
        {
          ...created.track,
          estimated_credits: created.task.estimated_credits,
          credits_cost: created.task.credits_cost,
          completed_at: created.task.completed_at,
        },
        voice ? { name: voice.name } : null,
      )

      return reply.status(201).send({
        id: created.batch.id,
        module: 'music',
        provider: credits.providerCode,
        model: payload.model,
        prompt: created.batch.prompt,
        params: created.batch.params,
        quantity: 1,
        completed_count: 0,
        failed_count: 0,
        status: 'pending',
        estimated_credits: credits.estimatedCredits,
        actual_credits: 0,
        created_at: created.batch.created_at.toISOString?.() ?? String(created.batch.created_at),
        tasks: [toTaskResponse(created.task)],
        track,
      })
    } catch (error) {
      return sendMusicRouteError(reply, error, app.log, 'Music generate request failed')
    }
  })
}

export default route
