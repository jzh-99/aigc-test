import type { Kysely } from 'kysely'
import { sql } from 'kysely'

/**
 * provider_models 使用 provider_code 逻辑关联 providers.code。
 *
 * 业管模型规格数据只提供供应商 code，不提供本地 providers.id。这里移除
 * provider_id 外键依赖，让 models.json 初始化和 Toby 单模型回调都能直接按
 * (provider_code, code) 写入模型配置。
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE provider_models ADD COLUMN IF NOT EXISTS provider_code text`.execute(db)

  await sql`
    UPDATE provider_models pm
    SET provider_code = p.code
    FROM providers p
    WHERE p.id = pm.provider_id
      AND pm.provider_code IS NULL
  `.execute(db)

  await sql`ALTER TABLE provider_models ALTER COLUMN provider_code SET NOT NULL`.execute(db)
  await sql`DROP INDEX IF EXISTS idx_provider_models_provider`.execute(db)
  await sql`ALTER TABLE provider_models DROP CONSTRAINT IF EXISTS uq_provider_models_code`.execute(db)
  await sql`ALTER TABLE provider_models ADD CONSTRAINT uq_provider_models_provider_code_code UNIQUE (provider_code, code)`.execute(db)
  await sql`CREATE INDEX IF NOT EXISTS idx_provider_models_provider_code ON provider_models(provider_code)`.execute(db)
  await sql`ALTER TABLE provider_models DROP COLUMN IF EXISTS provider_id`.execute(db)

  await sql`COMMENT ON COLUMN provider_models.provider_code IS '供应商代码，逻辑关联 providers.code；模型初始化和业管回调以该字段作为供应商标识'`.execute(db)
  await sql`COMMENT ON CONSTRAINT uq_provider_models_provider_code_code ON provider_models IS '同一供应商代码下模型 code 唯一'`.execute(db)
  await sql`COMMENT ON INDEX idx_provider_models_provider_code IS '按供应商代码查询模型的索引'`.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE provider_models ADD COLUMN IF NOT EXISTS provider_id uuid`.execute(db)

  await sql`
    UPDATE provider_models pm
    SET provider_id = p.id
    FROM providers p
    WHERE p.code = pm.provider_code
      AND pm.provider_id IS NULL
  `.execute(db)

  await sql`ALTER TABLE provider_models ALTER COLUMN provider_id SET NOT NULL`.execute(db)
  await sql`DROP INDEX IF EXISTS idx_provider_models_provider_code`.execute(db)
  await sql`ALTER TABLE provider_models DROP CONSTRAINT IF EXISTS uq_provider_models_provider_code_code`.execute(db)
  await sql`ALTER TABLE provider_models ADD CONSTRAINT uq_provider_models_code UNIQUE (provider_id, code)`.execute(db)
  await sql`ALTER TABLE provider_models ADD CONSTRAINT provider_models_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES providers(id)`.execute(db)
  await sql`CREATE INDEX IF NOT EXISTS idx_provider_models_provider ON provider_models(provider_id)`.execute(db)
  await sql`ALTER TABLE provider_models DROP COLUMN IF EXISTS provider_code`.execute(db)
}
