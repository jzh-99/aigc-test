import { Worker } from 'bullmq'
import { getDb } from '@aigc/db'
import { sql } from 'kysely'
import type { MusicVoiceCloneJobData } from '@aigc/types'
import { getBullMQConnection, getPubRedis } from '../lib/redis.js'
import { buildLogger } from '../logger.js'
import { MurekaClient } from '../lib/mureka.js'

const logger = buildLogger()

async function publishVoiceCloneEvent(voiceCloneId: string, payload: Record<string, unknown>): Promise<void> {
  try {
    await getPubRedis().publish(`sse:music_voice_clone:${voiceCloneId}`, JSON.stringify(payload))
  } catch (error) {
    logger.warn({ err: error, voiceCloneId }, '音色克隆 SSE 发布失败')
  }
}

async function confirmVoiceCloneCredits(data: MusicVoiceCloneJobData, actualCredits: number): Promise<void> {
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
      description: '音乐音色克隆成功',
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

async function failVoiceCloneJob(data: MusicVoiceCloneJobData, message: string): Promise<void> {
  const db = getDb()
  const now = new Date().toISOString()
  await db.transaction().execute(async (trx: any) => {
    const locked = await sql<{ status: string }>`SELECT status FROM tasks WHERE id = ${data.taskId} FOR UPDATE`.execute(trx)
    const current = locked.rows[0]?.status
    if (current === 'completed' || current === 'failed') return

    await trx.updateTable('music_voice_clones').set({
      status: 'failed',
      error_message: message.slice(0, 1000),
    }).where('id', '=', data.voiceCloneId).execute()

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
      description: `音乐音色克隆失败：${message.slice(0, 200)}`,
    }).execute()

    await trx.updateTable('task_batches').set({
      failed_count: sql`failed_count + 1`,
      status: 'failed',
    }).where('id', '=', data.batchId).execute()
  })
  await publishVoiceCloneEvent(data.voiceCloneId, { event: 'failed', error_message: message })
}

export const musicVoiceCloneWorker = new Worker<MusicVoiceCloneJobData>(
  'music-voice-clone-queue',
  async (job) => {
    const data = job.data
    const db = getDb()
    const logCtx = { jobId: job.id, taskId: data.taskId, voiceCloneId: data.voiceCloneId }
    logger.info(logCtx, '开始处理音色克隆任务')

    await db.updateTable('tasks').set({
      status: 'processing',
      processing_started_at: new Date().toISOString(),
      queue_job_id: job.id ?? null,
    }).where('id', '=', data.taskId).execute()
    await db.updateTable('task_batches').set({ status: 'processing' }).where('id', '=', data.batchId).where('status', '=', 'pending').execute()
    await db.updateTable('music_voice_clones').set({ status: 'processing' }).where('id', '=', data.voiceCloneId).execute()
    await publishVoiceCloneEvent(data.voiceCloneId, { event: 'status', status: 'processing' })

    try {
      const voice = await db
        .selectFrom('music_voice_clones')
        .selectAll()
        .where('id', '=', data.voiceCloneId)
        .executeTakeFirstOrThrow()

      const sourceAudioUrl = voice.source_audio_storage_url ?? voice.source_audio_url
      if (!sourceAudioUrl) throw new Error('音色克隆缺少源音频')

      const mureka = new MurekaClient({
        auditContext: {
          batchId: data.batchId,
          taskId: data.taskId,
          userId: data.userId,
          teamId: data.teamId,
          workspaceId: data.workspaceId,
          module: 'music_voice_clone',
        },
      })
      let result = await mureka.cloneVoice({
        audioUrl: sourceAudioUrl,
        name: voice.name,
        description: voice.description,
        gender: voice.gender,
      })

      if (!result.voice_id && result.task_id) {
        result = await mureka.pollVoiceCloneResult(result.task_id)
      }
      if (!result.voice_id) throw new Error(result.error_message ?? 'Mureka 未返回 voice_id')

      await db.updateTable('music_voice_clones').set({
        status: 'ready',
        voice_id: result.voice_id,
        external_voice_id: result.voice_id,
        external_task_id: result.task_id ?? result.id ?? null,
      }).where('id', '=', data.voiceCloneId).execute()

      await confirmVoiceCloneCredits(data, data.estimatedCredits)
      await publishVoiceCloneEvent(data.voiceCloneId, { event: 'ready', voice_id: result.voice_id })
      logger.info({ ...logCtx, voiceId: result.voice_id }, '音色克隆任务完成')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error({ ...logCtx, err: message }, '音色克隆任务失败')
      await failVoiceCloneJob(data, message)
    }
  },
  {
    connection: getBullMQConnection(),
    concurrency: 2,
    lockDuration: 30 * 60_000,
  },
)

musicVoiceCloneWorker.on('error', (err) => {
  logger.error({ err: err.message }, 'Music voice clone worker 错误')
})
