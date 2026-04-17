import { getDb } from '@aigc/db'
import { sql } from 'kysely'
import pino_ from 'pino'

const pino = pino_ as any
const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' })

// Retention periods
const AI_ERRORS_RETENTION_DAYS = 7
const PROMPT_FILTER_LOGS_RETENTION_DAYS = 30
const WEBHOOK_LOGS_RETENTION_DAYS = 30

export async function runPurgeOldRecords(): Promise<void> {
  const db = getDb()

  const aiErrorsCutoff = new Date(Date.now() - AI_ERRORS_RETENTION_DAYS * 24 * 60 * 60 * 1000)
  const { numDeletedRows: aiErrorsDeleted } = await db
    .deleteFrom('ai_assistant_errors')
    .where('created_at', '<', aiErrorsCutoff as any)
    .executeTakeFirst()

  const filterLogsCutoff = new Date(Date.now() - PROMPT_FILTER_LOGS_RETENTION_DAYS * 24 * 60 * 60 * 1000)
  const { numDeletedRows: filterLogsDeleted } = await db
    .deleteFrom('prompt_filter_logs')
    .where('created_at', '<', filterLogsCutoff as any)
    .executeTakeFirst()

  const webhookLogsCutoff = new Date(Date.now() - WEBHOOK_LOGS_RETENTION_DAYS * 24 * 60 * 60 * 1000)
  const { numDeletedRows: webhookLogsDeleted } = await db
    .deleteFrom('webhook_logs')
    .where('processed_at', '<', webhookLogsCutoff as any)
    .executeTakeFirst()

  const total = Number(aiErrorsDeleted) + Number(filterLogsDeleted) + Number(webhookLogsDeleted)
  if (total > 0) {
    logger.info(
      { aiErrorsDeleted: Number(aiErrorsDeleted), filterLogsDeleted: Number(filterLogsDeleted), webhookLogsDeleted: Number(webhookLogsDeleted) },
      'Purged old records',
    )
  }
}
