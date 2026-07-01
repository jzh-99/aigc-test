import type { Kysely } from 'kysely'
import { sql } from 'kysely'

// ============================================================================
// 把 provider_models.params_pricing 里的 model 字段从「业务名」更新为「真实 API model id」
//
// 背景：早期 params_pricing.model 存的是业务友好名（如 seedream-4.5），adapter 里有
// MODEL_ID_MAP 等硬编码映射表把它转成真实 id（如 doubao-seedream-4-5-251128）再调 API。
// 现在改为：params_pricing.model 直接存真实 API id，通过 resolveUnitPrice 替换链路传给
// adapter，adapter 直传（参考 tokenbus 模式），干掉所有硬编码映射表。
//
// 注意：
//   - 本迁移只改 params_pricing JSONB 数组里每个元素的 model 值；provider_models.code
//     保持业务名不动（前端/计费/路由按 code 查询，向后兼容）。
//   - ctyun 在 models.json 里 modelProvider='ctyun'，但 DB 里 provider_code='ctyun-edge'
//     （provider-models-json.ts 的 PROVIDER_CODE_ALIASES 别名映射），这里用 ctyun-edge。
//   - tokenbus/comfly 模型不动（tokenbus 的 code 本就是真实 id）。
//   - 本地 dev 重跑 db:seed 会用 models.json 覆盖（upsert），本迁移主要服务于已部署环境，
//     避免依赖手动 reseed。
// ============================================================================

interface PricingRule {
  resolution: string
  model: string
  unit_price: number
}

interface ModelUpdate {
  providerCode: string
  code: string
  pricing: PricingRule[]
}

const MODEL_UPDATES: ModelUpdate[] = [
  // ── volcengine 图片（Seedream）──
  {
    providerCode: 'volcengine',
    code: 'seedream-5.0-lite',
    pricing: [
      { resolution: '2k', model: 'doubao-seedream-5-0-lite-260128', unit_price: 3 },
      { resolution: '3k', model: 'doubao-seedream-5-0-lite-260128', unit_price: 3 },
      { resolution: '4k', model: 'doubao-seedream-5-0-lite-260128', unit_price: 3 },
    ],
  },
  {
    providerCode: 'volcengine',
    code: 'seedream-4.5',
    pricing: [
      { resolution: '2k', model: 'doubao-seedream-4-5-251128', unit_price: 3 },
      { resolution: '4k', model: 'doubao-seedream-4-5-251128', unit_price: 3 },
    ],
  },
  {
    providerCode: 'volcengine',
    code: 'seedream-4.0',
    pricing: [
      { resolution: '1k', model: 'doubao-seedream-4-0-250828', unit_price: 3 },
      { resolution: '2k', model: 'doubao-seedream-4-0-250828', unit_price: 3 },
      { resolution: '4k', model: 'doubao-seedream-4-0-250828', unit_price: 3 },
    ],
  },
  // ── volcengine 视频（Seedance）──
  {
    providerCode: 'volcengine',
    code: 'seedance-1.5-pro',
    pricing: [
      { resolution: '480p', model: 'doubao-seedance-1-5-pro-251215', unit_price: 5 },
      { resolution: '720p', model: 'doubao-seedance-1-5-pro-251215', unit_price: 10 },
      { resolution: '1080p', model: 'doubao-seedance-1-5-pro-251215', unit_price: 20 },
    ],
  },
  {
    providerCode: 'volcengine',
    code: 'seedance-2.0',
    pricing: [
      { resolution: '480p', model: 'doubao-seedance-2-0-260128', unit_price: 5 },
      { resolution: '720p', model: 'doubao-seedance-2-0-260128', unit_price: 10 },
      { resolution: '1080p', model: 'doubao-seedance-2-0-260128', unit_price: 25 },
    ],
  },
  {
    providerCode: 'volcengine',
    code: 'seedance-2.0-fast',
    pricing: [
      { resolution: '720p', model: 'doubao-seedance-2-0-fast-260128', unit_price: 8 },
      { resolution: '480p', model: 'doubao-seedance-2-0-fast-260128', unit_price: 4 },
    ],
  },
  // ── ctyun-edge 图片（自映射，model 值未变，但为统一也更新）──
  {
    providerCode: 'ctyun-edge',
    code: 'ctyun-seedream-5.0-lite',
    pricing: [
      { resolution: '2k', model: 'ctyun-seedream-5.0-lite', unit_price: 3 },
      { resolution: '3k', model: 'ctyun-seedream-5.0-lite', unit_price: 3 },
      { resolution: '4k', model: 'ctyun-seedream-5.0-lite', unit_price: 3 },
    ],
  },
  // ── ctyun-edge 视频（Seedance，真实 id 是 cdance*）──
  {
    providerCode: 'ctyun-edge',
    code: 'ctyun-seedance-2.0',
    pricing: [
      { resolution: '720p', model: 'cdance2.0-0611', unit_price: 10 },
      { resolution: '1080p', model: 'cdance2.0-0611', unit_price: 20 },
      { resolution: '480p', model: 'cdance2.0-0611', unit_price: 5 },
    ],
  },
  {
    providerCode: 'ctyun-edge',
    code: 'ctyun-seedance-2.0-fast',
    pricing: [
      { resolution: '720p', model: 'cdance2.0-fast-0611', unit_price: 8 },
      { resolution: '480p', model: 'cdance2.0-fast-0611', unit_price: 4 },
    ],
  },
]

export async function up(db: Kysely<any>): Promise<void> {
  for (const m of MODEL_UPDATES) {
    // 整体覆盖 params_pricing（resolution/unit_price 不变，只 model 改成真实 id）
    // 用 ${JSON.stringify(...)}::jsonb 把 JS 数组序列化为 jsonb（参考 082 迁移写法）
    await sql`
      UPDATE provider_models
      SET params_pricing = ${JSON.stringify(m.pricing)}::jsonb
      WHERE provider_code = ${m.providerCode} AND code = ${m.code}
    `.execute(db)
  }
}

export async function down(db: Kysely<any>): Promise<void> {
  // 回滚：把 model 改回业务名（code）。由于 model 原值与 code 相同，用 code 回填。
  for (const m of MODEL_UPDATES) {
    const restored = m.pricing.map((p) => ({ ...p, model: m.code }))
    await sql`
      UPDATE provider_models
      SET params_pricing = ${JSON.stringify(restored)}::jsonb
      WHERE provider_code = ${m.providerCode} AND code = ${m.code}
    `.execute(db)
  }
}
