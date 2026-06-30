import type { Kysely } from 'kysely'
import { sql } from 'kysely'

const CTYUN_SEEDREAM_5_PRICING = [
  { resolution: '2k', model: 'ctyun-seedream-5.0-lite', unit_price: 4 },
  { resolution: '3k', model: 'ctyun-seedream-5.0-lite', unit_price: 4 },
  { resolution: '4k', model: 'ctyun-seedream-5.0-lite', unit_price: 4 },
]

const LEGACY_CTYUN_SEEDREAM_5_PRICING = [
  { resolution: '2k', model: 'Doubao-Seedream-5.0-lite', unit_price: 4 },
  { resolution: '3k', model: 'Doubao-Seedream-5.0-lite', unit_price: 4 },
  { resolution: '4k', model: 'Doubao-Seedream-5.0-lite', unit_price: 4 },
]

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    UPDATE provider_models
    SET
      description = '天翼云边缘AI网关 ctyun-seedream-5.0-lite 图片生成',
      params_pricing = ${JSON.stringify(CTYUN_SEEDREAM_5_PRICING)}
    WHERE provider_code = 'ctyun-edge'
      AND code = 'ctyun-seedream-5.0-lite'
  `.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    UPDATE provider_models
    SET
      description = '天翼云边缘AI网关 Doubao-Seedream-5.0-lite 图片生成',
      params_pricing = ${JSON.stringify(LEGACY_CTYUN_SEEDREAM_5_PRICING)}
    WHERE provider_code = 'ctyun-edge'
      AND code = 'ctyun-seedream-5.0-lite'
  `.execute(db)
}
