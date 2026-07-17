import type { Kysely } from 'kysely'

export async function up(db: Kysely<any>): Promise<void> {
  // 添加完整的请求 URL 和业务来源字段
  await db.schema
    .alterTable('provider_api_logs')
    .addColumn('request_url', 'text') // 完整 URL（包含协议、host、路径、查询参数）
    .addColumn('referer', 'varchar(500)') // 业务来源（触发此次 AI 调用的业务接口路径）
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('provider_api_logs')
    .dropColumn('referer')
    .dropColumn('request_url')
    .execute()
}
