import { type Kysely, sql } from 'kysely'

/**
 * 清理 provider_models 表中错误插入的短剧导出费用配置
 *
 * short_drama_episode_export_credits 被错误地插入了 provider_models 表（module='video'），
 * 导致它混入视频模型列表。实际 API 通过环境变量读取该费用，不查 provider_models。
 * 该记录属于脏数据，需要删除。
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    DELETE FROM provider_models
    WHERE code = 'short_drama_episode_export_credits'
  `.execute(db)
}

export async function down(db: Kysely<any>): Promise<void> {
  // 无需回滚，这是清理脏数据
}
