import { type Kysely, sql } from 'kysely'

/**
 * provider_models 增加 avatar 字段
 *
 * 模型图标改为从数据库读取自托管图片 URL，替代 @lobehub/icons。
 * avatar 存完整 TOS 公网存储 URL，API 用 signAssetUrl 签名后返回前端。
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    ALTER TABLE provider_models ADD COLUMN avatar TEXT
  `.execute(db)
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`
    ALTER TABLE provider_models DROP COLUMN avatar
  `.execute(db)
}
