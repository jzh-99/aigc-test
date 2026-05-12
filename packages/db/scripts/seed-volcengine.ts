import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from 'dotenv'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
config({ path: path.resolve(__dirname, '../../../.env') })

import { getDb, closeDb } from '../src/client.js'

async function main() {
  const db = getDb()

  console.log('  Seeding Volcengine provider + models...')

  // 1. Upsert Volcengine provider
  const providerResult = await db
    .insertInto('providers')
    .values({
      code: 'volcengine',
      name: '火山引擎',
      region: 'cn',
      modules: JSON.stringify(['image', 'video']),
      is_active: true,
      config: JSON.stringify({
        api_base_url: 'https://ark.cn-beijing.volces.com/api/v3',
      }),
    })
    .onConflict((oc: any) =>
      oc.column('code').doUpdateSet({
        name: '火山引擎',
        region: 'cn',
        modules: JSON.stringify(['image', 'video']),
        is_active: true,
        config: JSON.stringify({
          api_base_url: 'https://ark.cn-beijing.volces.com/api/v3',
        }),
      })
    )
    .returningAll()
    .execute()

  const provider = providerResult[0]
  console.log(`  providers upserted (volcengine, id=${provider.id})`)

  // 2. Upsert image models
  const imageModels = [
    {
      code: 'seedream-5.0-lite',
      name: 'Seedream 5.0',
      description: '最新火山引擎模型，联网搜索增强',
      credit_cost: 10,
      // 图片模型暂不区分分辨率定价，params_pricing 为空数组，回退 credit_cost
      params_pricing: JSON.stringify([]),
      params_schema: JSON.stringify({
        type: 'object',
        properties: {
          aspect_ratio: {
            type: 'string',
            enum: ['1:1', '16:9', '9:16', '4:3', '3:4'],
          },
          resolution: {
            type: 'string',
            enum: ['1k', '2k', '4k'],
          },
          image: { type: 'array', items: { type: 'string' } },
          watermark: { type: 'boolean' },
        },
      }),
    },
    {
      code: 'seedream-4.5',
      name: 'Seedream 4.5',
      description: '高分辨率图像生成',
      credit_cost: 10,
      params_pricing: JSON.stringify([]),
      params_schema: JSON.stringify({
        type: 'object',
        properties: {
          aspect_ratio: {
            type: 'string',
            enum: ['1:1', '16:9', '9:16', '4:3', '3:4'],
          },
          resolution: {
            type: 'string',
            enum: ['2k', '4k'],
          },
          image: { type: 'array', items: { type: 'string' } },
          watermark: { type: 'boolean' },
        },
      }),
    },
    {
      code: 'seedream-4.0',
      name: 'Seedream 4.0',
      description: '多分辨率图像生成',
      credit_cost: 10,
      params_pricing: JSON.stringify([]),
      params_schema: JSON.stringify({
        type: 'object',
        properties: {
          aspect_ratio: {
            type: 'string',
            enum: ['1:1', '16:9', '9:16', '4:3', '3:4'],
          },
          resolution: {
            type: 'string',
            enum: ['2k', '4k'],
          },
          image: { type: 'array', items: { type: 'string' } },
          watermark: { type: 'boolean' },
        },
      }),
    },
  ]

  for (const m of imageModels) {
    await db
      .insertInto('provider_models')
      .values({
        provider_id: provider.id,
        code: m.code,
        name: m.name,
        description: m.description,
        module: 'image',
        credit_cost: m.credit_cost,
        params_pricing: m.params_pricing,
        params_schema: m.params_schema,
        is_active: true,
      })
      .onConflict((oc: any) =>
        oc.columns(['provider_id', 'code']).doUpdateSet({
          name: m.name,
          description: m.description,
          module: 'image',
          credit_cost: m.credit_cost,
          params_pricing: m.params_pricing,
          params_schema: m.params_schema,
          is_active: true,
        })
      )
      .execute()
    console.log(`  provider_models upserted (${m.code})`)
  }

  // 3. Upsert video models（按秒计费，credit_cost 存每秒单价兜底，params_pricing 按分辨率差异化定价）
  const videoModels = [
    {
      code: 'seedance-1.5-pro',
      name: 'Seedance 1.5 Pro',
      description: '有声视频生成，支持首尾帧',
      credit_cost: 100,
      video_categories: ['frames', 'components'],
      // 720p/1080p 对应不同底层模型 ID 和每秒单价
      params_pricing: JSON.stringify([
        { model: 'doubao-seedance-1-5-pro-251215', resolution: '720p',  unit_price: 80  },
        { model: 'doubao-seedance-1-5-pro-251215', resolution: '1080p', unit_price: 100 },
      ]),
      params_schema: JSON.stringify({
        type: 'object',
        properties: {
          aspect_ratio: {
            type: 'string',
            enum: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', 'adaptive'],
          },
          resolution: { type: 'string', enum: ['720p', '1080p'] },
          duration: { type: 'integer' },
          generate_audio: { type: 'boolean' },
          camera_fixed: { type: 'boolean' },
        },
      }),
    },
    {
      code: 'seedance-2.0',
      name: 'Seedance 2.0',
      description: '高级有声视频生成，支持多模态',
      credit_cost: 5,
      video_categories: ['multimodal', 'frames', 'components'],
      params_pricing: JSON.stringify([
        { model: 'doubao-seedance-2-0-260128', resolution: '720p',  unit_price: 4 },
        { model: 'doubao-seedance-2-0-260128', resolution: '1080p', unit_price: 5 },
      ]),
      params_schema: JSON.stringify({
        type: 'object',
        properties: {
          aspect_ratio: {
            type: 'string',
            enum: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', 'adaptive'],
          },
          resolution: { type: 'string', enum: ['720p', '1080p'] },
          duration: { type: 'integer' },
          generate_audio: { type: 'boolean' },
          camera_fixed: { type: 'boolean' },
        },
      }),
    },
    {
      code: 'seedance-2.0-fast',
      name: 'Seedance 2.0 Fast',
      description: '快速有声视频生成，支持多模态',
      credit_cost: 5,
      video_categories: ['multimodal', 'frames', 'components'],
      params_pricing: JSON.stringify([
        { model: 'doubao-seedance-2-0-fast-260128', resolution: '720p',  unit_price: 3 },
        { model: 'doubao-seedance-2-0-fast-260128', resolution: '1080p', unit_price: 5 },
      ]),
      params_schema: JSON.stringify({
        type: 'object',
        properties: {
          aspect_ratio: {
            type: 'string',
            enum: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', 'adaptive'],
          },
          resolution: { type: 'string', enum: ['720p', '1080p'] },
          duration: { type: 'integer' },
          generate_audio: { type: 'boolean' },
          camera_fixed: { type: 'boolean' },
        },
      }),
    },
  ]

  for (const m of videoModels) {
    await db
      .insertInto('provider_models')
      .values({
        provider_id: provider.id,
        code: m.code,
        name: m.name,
        description: m.description,
        module: 'video',
        video_categories: JSON.stringify(m.video_categories),
        credit_cost: m.credit_cost,
        params_pricing: m.params_pricing,
        params_schema: m.params_schema,
        is_active: true,
      })
      .onConflict((oc: any) =>
        oc.columns(['provider_id', 'code']).doUpdateSet({
          name: m.name,
          description: m.description,
          video_categories: JSON.stringify(m.video_categories),
          credit_cost: m.credit_cost,
          params_pricing: m.params_pricing,
          params_schema: m.params_schema,
          is_active: true,
        })
      )
      .execute()
    console.log(`  provider_models upserted (${m.code})`)
  }

  // 4. Upsert avatar and action_imitation models (single-model, no selector shown)
  const singleModels = [
    {
      code: 'jimeng_realman_avatar_picture_omni_v15',
      name: '数字人生成',
      module: 'avatar' as const,
      // 按秒计费，每秒 50 积分
      credit_cost: 50,
    },
    {
      code: 'jimeng_dreamactor_m20_gen_video',
      name: '动作模仿',
      module: 'action_imitation' as const,
      // 按秒计费，每秒 20 积分
      credit_cost: 20,
    },
  ]

  for (const m of singleModels) {
    await db
      .insertInto('provider_models')
      .values({
        provider_id: provider.id,
        code: m.code,
        name: m.name,
        module: m.module,
        credit_cost: m.credit_cost,
        params_pricing: JSON.stringify([]),
        params_schema: JSON.stringify({}),
        is_active: true,
      })
      .onConflict((oc: any) =>
        oc.columns(['provider_id', 'code']).doUpdateSet({
          name: m.name,
          credit_cost: m.credit_cost,
          is_active: true,
        })
      )
      .execute()
    console.log(`  provider_models upserted (${m.code})`)
  }

  await closeDb()
  console.log('  Volcengine seed complete.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
