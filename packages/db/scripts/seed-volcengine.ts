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

  // 2. Upsert image models (credit_cost = 50 per image, flat rate for now)
  const imageModels = [
    {
      code: 'seedream-5.0-lite',
      name: 'Seedream 5.0',
      credit_cost: 50,
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
      credit_cost: 50,
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
      credit_cost: 50,
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
        module: 'image',
        credit_cost: m.credit_cost,
        params_pricing: JSON.stringify({}),
        params_schema: m.params_schema,
        is_active: true,
      })
      .onConflict((oc: any) =>
        oc.columns(['provider_id', 'code']).doUpdateSet({
          name: m.name,
          module: 'image',
          credit_cost: m.credit_cost,
          params_pricing: JSON.stringify({}),
          params_schema: m.params_schema,
          is_active: true,
        })
      )
      .execute()
    console.log(`  provider_models upserted (${m.code})`)
  }

  // 3. Upsert video model
  // credit_cost stores per-second price (100 credits/s)
  // Total cost is computed at request time: credit_cost * duration
  await db
    .insertInto('provider_models')
    .values({
      provider_id: provider.id,
      code: 'seedance-1.5-pro',
      name: 'Seedance 1.5 Pro',
      module: 'video',
      credit_cost: 100, // per-second price
      params_pricing: JSON.stringify({}),
      params_schema: JSON.stringify({
        type: 'object',
        properties: {
          aspect_ratio: {
            type: 'string',
            enum: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', 'adaptive'],
          },
          resolution: {
            type: 'string',
            enum: ['720p', '1080p'],
          },
          duration: { type: 'integer' },
          generate_audio: { type: 'boolean' },
          camera_fixed: { type: 'boolean' },
        },
      }),
      is_active: true,
    })
    .onConflict((oc: any) =>
      oc.columns(['provider_id', 'code']).doUpdateSet({
        name: 'Seedance 1.5 Pro',
        module: 'video',
        credit_cost: 100,
        params_pricing: JSON.stringify({}),
        params_schema: JSON.stringify({
          type: 'object',
          properties: {
            aspect_ratio: {
              type: 'string',
              enum: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', 'adaptive'],
            },
            resolution: {
              type: 'string',
              enum: ['720p', '1080p'],
            },
            duration: { type: 'integer' },
            generate_audio: { type: 'boolean' },
            camera_fixed: { type: 'boolean' },
          },
        }),
        is_active: true,
      })
    )
    .execute()
  console.log('  provider_models upserted (seedance-1.5-pro, 100 credits/s)')

  await closeDb()
  console.log('  Volcengine seed complete.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
