import { Worker, Queue } from 'bullmq'
import { getBullMQConnection } from '../lib/redis.js'
import { runTimeoutGuardian } from '../jobs/timeout-guardian.js'
import { runPurgeOldRecords } from '../jobs/purge-old-records.js'
import { runPurgeDeletedProjects } from '../jobs/purge-deleted-projects.js'
import { buildLogger } from '../logger.js'

const logger = buildLogger()

export const CRON_QUEUE_NAME = 'cron-queue'

// 定时任务名称常量
export const CRON_JOB_TIMEOUT_GUARDIAN = 'timeout-guardian'
export const CRON_JOB_PURGE_OLD_RECORDS = 'purge-old-records'
export const CRON_JOB_PURGE_DELETED_PROJECTS = 'purge-deleted-projects'

/**
 * 注册 BullMQ repeat job，多台机器调用是幂等的——相同 name+pattern 只会存在一个调度
 */
export async function scheduleCronJobs(): Promise<void> {
  const queue = new Queue(CRON_QUEUE_NAME, { connection: getBullMQConnection() })

  await queue.upsertJobScheduler(
    CRON_JOB_TIMEOUT_GUARDIAN,
    { every: 5 * 60 * 1000 }, // 每 5 分钟
    { name: CRON_JOB_TIMEOUT_GUARDIAN },
  )

  await queue.upsertJobScheduler(
    CRON_JOB_PURGE_OLD_RECORDS,
    { every: 24 * 60 * 60 * 1000 }, // 每天
    { name: CRON_JOB_PURGE_OLD_RECORDS },
  )

  await queue.upsertJobScheduler(
    CRON_JOB_PURGE_DELETED_PROJECTS,
    { every: 24 * 60 * 60 * 1000 }, // 每天
    { name: CRON_JOB_PURGE_DELETED_PROJECTS },
  )

  await queue.close()
  logger.info('Cron jobs scheduled via BullMQ repeat')
}

export const cronWorker = new Worker(
  CRON_QUEUE_NAME,
  async (job) => {
    switch (job.name) {
      case CRON_JOB_TIMEOUT_GUARDIAN:
        await runTimeoutGuardian()
        break
      case CRON_JOB_PURGE_OLD_RECORDS:
        await runPurgeOldRecords()
        break
      case CRON_JOB_PURGE_DELETED_PROJECTS:
        await runPurgeDeletedProjects()
        break
      default:
        logger.warn({ jobName: job.name }, 'cron-queue 收到未知 job，跳过')
    }
  },
  {
    connection: getBullMQConnection(),
    // 定时任务串行执行，避免同一台机器上重叠运行
    concurrency: 1,
  },
)

cronWorker.on('error', (err) => {
  logger.error({ err: err.message }, 'Cron worker 错误')
})
