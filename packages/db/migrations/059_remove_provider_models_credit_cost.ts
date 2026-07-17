import type { Kysely } from 'kysely'
import { sql } from 'kysely'

/**
 * 移除 provider_models.credit_cost 字段。
 * 统一使用 params_pricing 规则数组定价，不再需要 credit_cost 兜底。
 *
 * 安全措施：先为 params_pricing 为空或 null 的记录自动生成默认规则，
 * 再删除 credit_cost 列，确保所有模型都有可用定价。
 */
export async function up(db: Kysely<any>): Promise<void> {
  // 1. 为 params_pricing 为空数组或 null 的记录，从 credit_cost 生成默认规则
  await sql`
    UPDATE provider_models
    SET params_pricing = json_build_array(
      json_build_object('resolution', 'default', 'model', code, 'unit_price', credit_cost)
    )
    WHERE params_pricing IS NULL OR params_pricing::jsonb = '[]'::jsonb
  `.execute(db)

  // 2. 确认所有记录都有 params_pricing 后，删除 credit_cost 列
  await db.schema
    .alterTable('provider_models')
    .dropColumn('credit_cost')
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  // 回滚：重新添加 credit_cost 列，默认值 0
  await db.schema
    .alterTable('provider_models')
    .addColumn('credit_cost', 'integer', (col) => col.notNull().defaultTo(0))
    .execute()

  // 从 params_pricing 中提取第一个规则的 unit_price 回填 credit_cost
  await sql`
    UPDATE provider_models
    SET credit_cost = COALESCE(
      (params_pricing::jsonb -> 0 ->> 'unit_price')::integer,
      0
    )
  `.execute(db)
}
