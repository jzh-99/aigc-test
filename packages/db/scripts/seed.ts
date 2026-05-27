import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from 'dotenv'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
config({ path: path.resolve(__dirname, '../../../.env') })

import bcrypt from 'bcryptjs'
import { sql } from 'kysely'
import { getDb, closeDb } from '../src/client.js'

async function main() {
  const db = getDb()

  console.log('  Seeding database...')

  // 1. Subscription plan (free tier) — select or insert
  let plan = await db
    .selectFrom('subscription_plans')
    .selectAll()
    .where('tier', '=', 'free')
    .executeTakeFirst()

  if (!plan) {
    const planResult = await db
      .insertInto('subscription_plans')
      .values({
        name: 'Free',
        tier: 'free',
        credits_monthly: 100,
        max_concurrency: 2,
        max_batch_size: 2,
        features: JSON.stringify({ watermark: true, hd: false }),
        is_active: true,
      })
      .returningAll()
      .execute()
    plan = planResult[0]
  }
  console.log('  subscription_plans seeded')

  // 2. Users — admin, owner, editor
  const adminHash = await bcrypt.hash('admin123', 10)
  const ownerHash = await bcrypt.hash('owner123', 10)
  const editorHash = await bcrypt.hash('editor123', 10)

  // Helper: insert user if not exists, otherwise fetch existing
  async function upsertUser(values: {
    email: string; username: string; password_hash: string
    account: string; role: string; status: string; plan_tier: string
  }) {
    const rows = await db
      .insertInto('users')
      .values(values)
      .onConflict((oc: any) => oc.column('email').doNothing())
      .returningAll()
      .execute()
    if (rows.length > 0) return rows[0]
    return db.selectFrom('users').selectAll().where('email', '=', values.email).executeTakeFirstOrThrow()
  }

  // Admin user
  const adminUser = await upsertUser({
    email: 'admin@aigc.local', username: 'admin', password_hash: adminHash,
    account: 'admin', role: 'admin', status: 'active', plan_tier: 'free',
  })
  console.log('  users seeded (admin@aigc.local)')

  // Owner user
  const ownerUser = await upsertUser({
    email: 'owner@aigc.local', username: 'teamowner', password_hash: ownerHash,
    account: 'owner', role: 'member', status: 'active', plan_tier: 'free',
  })
  console.log('  users seeded (owner@aigc.local)')

  // Editor user
  const editorUser = await upsertUser({
    email: 'editor@aigc.local', username: 'editor', password_hash: editorHash,
    account: 'editor', role: 'member', status: 'active', plan_tier: 'free',
  })
  console.log('  users seeded (editor@aigc.local)')

  // 3. User subscription for owner (active, 1 year) — skip if exists
  const existingSub = await db
    .selectFrom('user_subscriptions')
    .selectAll()
    .where('user_id', '=', ownerUser.id)
    .executeTakeFirst()

  if (!existingSub) {
    const oneYear = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
    await db
      .insertInto('user_subscriptions')
      .values({
        user_id: ownerUser.id,
        plan_id: plan!.id,
        status: 'active',
        started_at: new Date().toISOString(),
        expires_at: oneYear.toISOString(),
      })
      .execute()
  }
  console.log('  user_subscriptions seeded')

  // 4. Team — check-first pattern (no unique constraint on name)
  let team = await db
    .selectFrom('teams')
    .selectAll()
    .where('name', '=', '测试团队')
    .executeTakeFirst()

  if (!team) {
    const teamResult = await db
      .insertInto('teams')
      .values({
        name: '测试团队',
        owner_id: ownerUser.id,
        plan_tier: 'free',
      })
      .returningAll()
      .execute()
    team = teamResult[0]
  } else {
    // Update owner if team already exists
    await db
      .updateTable('teams')
      .set({ owner_id: ownerUser.id })
      .where('id', '=', team.id)
      .execute()
  }
  console.log('  teams seeded (测试团队)')

  // 5. Team members — upsert via PK (team_id, user_id)
  // Owner
  await db
    .insertInto('team_members')
    .values({
      team_id: team.id,
      user_id: ownerUser.id,
      role: 'owner',
    })
    .onConflict((oc: any) => oc.columns(['team_id', 'user_id']).doUpdateSet({ role: 'owner' }))
    .execute()

  // Editor with quota
  await db
    .insertInto('team_members')
    .values({
      team_id: team.id,
      user_id: editorUser.id,
      role: 'editor',
      credit_quota: 1000,
      credit_used: 0,
    })
    .onConflict((oc: any) => oc.columns(['team_id', 'user_id']).doUpdateSet({
      role: 'editor',
      credit_quota: 1000,
      credit_used: 0,
    }))
    .execute()
  console.log('  team_members seeded')

  // 6. Default workspace — check-first pattern (no unique constraint on team_id+name)
  let workspace = await db
    .selectFrom('workspaces')
    .selectAll()
    .where('team_id', '=', team.id)
    .where('name', '=', '默认工作区')
    .executeTakeFirst()

  if (!workspace) {
    const wsResult = await db
      .insertInto('workspaces')
      .values({
        team_id: team.id,
        name: '默认工作区',
        created_by: ownerUser.id,
      })
      .returningAll()
      .execute()
    workspace = wsResult[0]
  }
  console.log('  workspaces seeded (默认工作区)')

  // 7. Workspace members — upsert via unique constraint (workspace_id, user_id)
  await db
    .insertInto('workspace_members')
    .values({
      workspace_id: workspace.id,
      user_id: ownerUser.id,
      role: 'admin',
    })
    .onConflict((oc: any) => oc.columns(['workspace_id', 'user_id']).doUpdateSet({ role: 'admin' }))
    .execute()

  await db
    .insertInto('workspace_members')
    .values({
      workspace_id: workspace.id,
      user_id: editorUser.id,
      role: 'editor',
    })
    .onConflict((oc: any) => oc.columns(['workspace_id', 'user_id']).doUpdateSet({ role: 'editor' }))
    .execute()
  console.log('  workspace_members seeded')

  // 8. Team credit account with 10000 credits — skip if exists
  const existingTeamCredit = await db
    .selectFrom('credit_accounts')
    .selectAll()
    .where('team_id', '=', team.id)
    .where('owner_type', '=', 'team')
    .executeTakeFirst()

  if (!existingTeamCredit) {
    await db
      .insertInto('credit_accounts')
      .values({
        owner_type: 'team',
        team_id: team.id,
        balance: 10000,
        frozen_credits: 0,
        total_earned: 10000,
        total_spent: 0,
      })
      .execute()
  }
  console.log('  team credit_accounts seeded (10000 credits)')

  // 8b. Admin team + workspace + credits — admin gets their own space
  let adminTeam = await db
    .selectFrom('teams')
    .selectAll()
    .where('name', '=', '管理员')
    .executeTakeFirst()

  if (!adminTeam) {
    const atResult = await db
      .insertInto('teams')
      .values({
        name: '管理员',
        owner_id: adminUser.id,
        plan_tier: 'free',
      })
      .returningAll()
      .execute()
    adminTeam = atResult[0]
  } else {
    await db
      .updateTable('teams')
      .set({ owner_id: adminUser.id })
      .where('id', '=', adminTeam.id)
      .execute()
  }

  await db
    .insertInto('team_members')
    .values({
      team_id: adminTeam.id,
      user_id: adminUser.id,
      role: 'owner',
    })
    .onConflict((oc: any) => oc.columns(['team_id', 'user_id']).doUpdateSet({ role: 'owner' }))
    .execute()

  let adminWorkspace = await db
    .selectFrom('workspaces')
    .selectAll()
    .where('team_id', '=', adminTeam.id)
    .where('name', '=', '管理员工作区')
    .executeTakeFirst()

  if (!adminWorkspace) {
    const awResult = await db
      .insertInto('workspaces')
      .values({
        team_id: adminTeam.id,
        name: '管理员工作区',
        created_by: adminUser.id,
      })
      .returningAll()
      .execute()
    adminWorkspace = awResult[0]
  }

  await db
    .insertInto('workspace_members')
    .values({
      workspace_id: adminWorkspace.id,
      user_id: adminUser.id,
      role: 'admin',
    })
    .onConflict((oc: any) => oc.columns(['workspace_id', 'user_id']).doUpdateSet({ role: 'admin' }))
    .execute()

  const existingAdminCredit = await db
    .selectFrom('credit_accounts')
    .selectAll()
    .where('team_id', '=', adminTeam.id)
    .where('owner_type', '=', 'team')
    .executeTakeFirst()

  if (!existingAdminCredit) {
    await db
      .insertInto('credit_accounts')
      .values({
        owner_type: 'team',
        team_id: adminTeam.id,
        balance: 99999,
        frozen_credits: 0,
        total_earned: 99999,
        total_spent: 0,
      })
      .execute()
  }
  console.log('  admin team + workspace + credits seeded (管理员)')

  // 9. Provider: Qwen — 画布文本节点、分镜拆分等文本类能力使用
  const qwenResult = await db
    .insertInto('providers')
    .values({
      code: 'qwen',
      name: '通义千问',
      region: 'cn',
      modules: JSON.stringify(['agent']),
      is_active: true,
      config: JSON.stringify({
        api_base_url: process.env.QWEN_API_URL ?? 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      }),
    })
    .onConflict((oc: any) => oc.column('code').doUpdateSet({
      name: '通义千问',
      region: 'cn',
      modules: JSON.stringify(['agent']),
      is_active: true,
      config: JSON.stringify({
        api_base_url: process.env.QWEN_API_URL ?? 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      }),
    }))
    .returningAll()
    .execute()

  const qwenProvider = qwenResult[0]
  console.log(`  providers seeded (qwen, id=${qwenProvider.id})`)

  const ZERO_REFERENCE_LIMIT = { min: 0, max: 0 }
  const TEXT_TO_TEXT_CATEGORY_REFERENCES = {
    text_to_text: {
      label: '文本生成',
      limits: {
        image: ZERO_REFERENCE_LIMIT,
        video: ZERO_REFERENCE_LIMIT,
        audio: ZERO_REFERENCE_LIMIT,
        text: ZERO_REFERENCE_LIMIT,
      },
    },
  }

  // Picture book defaults:
  // - text / script split: qwen3.6-plus
  // - image: seedream-5.0-lite
  // - tts: speech-2.8-hd
  const qwenModelCode = process.env.QWEN_MODEL?.trim() || 'qwen3.6-plus'
  const qwenAgentModels = [
    {
      code: qwenModelCode,
      name: qwenModelCode,
      description: '画布文本节点 AI 生成、分镜拆分等文本类任务使用的 Qwen 模型',
      credit_cost: 1,
      params_pricing: [{ resolution: 'default', model: qwenModelCode, unit_price: 1 }],
      category_references: TEXT_TO_TEXT_CATEGORY_REFERENCES,
      params_schema: {
        endpoint: 'chat/completions',
        stream: [true, false],
        enable_thinking: [false, true],
        max_tokens: [2000, 4000, 16000],
        usage: ['canvas_text_gen', 'storyboard_split'],
      },
    },
  ]

  for (const m of qwenAgentModels) {
    await db
      .insertInto('provider_models')
      .values({
        provider_id: qwenProvider.id,
        code: m.code,
        name: m.name,
        description: m.description,
        module: 'agent',
        category_references: JSON.stringify(m.category_references),
        credit_cost: m.credit_cost,
        params_pricing: JSON.stringify(m.params_pricing),
        params_schema: JSON.stringify(m.params_schema),
        is_active: true,
      })
      .onConflict((oc: any) => oc.columns(['provider_id', 'code']).doUpdateSet({
        name: m.name,
        description: m.description,
        module: 'agent',
        category_references: JSON.stringify(m.category_references),
        credit_cost: m.credit_cost,
        params_pricing: JSON.stringify(m.params_pricing),
        params_schema: JSON.stringify(m.params_schema),
        is_active: true,
      }))
      .execute()
    console.log(`  provider_models seeded (${m.code})`)
  }

  // 10. Provider: Nano Banana — upsert by code
  const providerResult = await db
    .insertInto('providers')
    .values({
      code: 'comfly',
      name: 'Comfly',
      region: 'global',
      modules: JSON.stringify(['image']),
      is_active: true,
      config: JSON.stringify({
        api_base_url:
          process.env.NANO_BANANA_API_URL ?? '',
      }),
    })
    .onConflict((oc: any) => oc.column('code').doUpdateSet({
      name: 'Comfly',
      region: 'global',
      modules: JSON.stringify(['image']),
      is_active: true,
      config: JSON.stringify({
        api_base_url:
          process.env.NANO_BANANA_API_URL ?? '',
      }),
    }))
    .returningAll()
    .execute()

  const provider = providerResult[0]
  console.log('  providers seeded (comfly)')

  const SIX_IMAGE_CATEGORY_REFERENCES = {
    text_to_image: {
      label: '文生图',
      limits: {
        image: ZERO_REFERENCE_LIMIT,
        video: ZERO_REFERENCE_LIMIT,
        audio: ZERO_REFERENCE_LIMIT,
        text: ZERO_REFERENCE_LIMIT,
      },
    },
    image_to_image: {
      label: '图生图',
      limits: {
        image: { min: 0, max: 6 },
        video: ZERO_REFERENCE_LIMIT,
        audio: ZERO_REFERENCE_LIMIT,
        text: ZERO_REFERENCE_LIMIT,
      },
    },
  }

  const SEEDREAM_IMAGE_CATEGORY_REFERENCES = {
    text_to_image: SIX_IMAGE_CATEGORY_REFERENCES.text_to_image,
    image_to_image: {
      label: '图生图',
      limits: {
        image: { min: 0, max: 14 },
        video: ZERO_REFERENCE_LIMIT,
        audio: ZERO_REFERENCE_LIMIT,
        text: ZERO_REFERENCE_LIMIT,
      },
    },
  }

  // 11. Provider models: comfly 图片模型 — upsert by code
  const imageModels = [
    // {
    //   code: 'nano-banana-2-2k',
    //   name: 'Nano Banana 2-2k',
    //   description: '高质量输出，细节丰富',
    //   credit_cost: 10,
    // },
    {
      code: 'gemini-3.1-flash-image-preview',
      name: '全能图片2',
      description: '快速生成，适合日常使用',
      credit_cost: 1,
      params_pricing: [
        { resolution: '1k', model: 'gemini-3.1-flash-image-preview', unit_price: 1 },
        { resolution: '2k', model: 'gemini-3.1-flash-image-preview-2k', unit_price: 1 },
        { resolution: '4k', model: 'gemini-3.1-flash-image-preview-4k', unit_price: 1 },
      ],
      params_schema: {
        resolution: ['1k', '2k', '4k'],
        aspect_ratio: ['1:1', '4:3', '3:4', '16:9', '9:16'],
        image: [],
      },
      category_references: SIX_IMAGE_CATEGORY_REFERENCES,
    },
    {
      code: 'gpt-image-2',
      name: '超能图片2',
      description: '文字渲染准确，UI截图逼真，照片级真实感',
      credit_cost: 2,
      params_pricing: [
        { resolution: '2k', model: 'gpt-image-2', unit_price: 2 },
      ],
      params_schema: {
        resolution: ['2k'],
        aspect_ratio: ['1:1', '4:3', '3:4', '16:9', '9:16'],
        image: [],
      },
      category_references: SIX_IMAGE_CATEGORY_REFERENCES,
    },
    {
      code: 'nano-banana-2',
      name: '全能图片Pro',
      description: '高质量输出，细节丰富',
      credit_cost: 4,
      params_pricing: [
        { resolution: '1k', model: 'nano-banana-2', unit_price: 4 },
        { resolution: '2k', model: 'nano-banana-2-2k', unit_price: 4 },
        { resolution: '4k', model: 'nano-banana-2-4k', unit_price: 4 },
      ],
      params_schema: {
        resolution: ['1k', '2k', '4k'],
        aspect_ratio: ['1:1', '4:3', '3:4', '16:9', '9:16'],
        image: [],
      },
      category_references: SIX_IMAGE_CATEGORY_REFERENCES,
    },
  ]

  // const imageModelsParamsSchema = JSON.stringify({
  //   resolution: ['480p', '720p', '1080p'],
  //   aspect_ratio: ['1:1', '4:3', '3:4', '16:9', '9:16'],
  //   image: [],
  // })

  for (const m of imageModels) {
    await db
      .insertInto('provider_models')
      .values({
        provider_id: provider.id,
        code: m.code,
        name: m.name,
        description: m.description,
        module: 'image',
        category_references: JSON.stringify(m.category_references),
        credit_cost: m.credit_cost,
        params_pricing: JSON.stringify((m.params_pricing ?? [])),
        params_schema: JSON.stringify(m.params_schema),
        is_active: true,
      })
      .onConflict((oc: any) => oc.columns(['provider_id', 'code']).doUpdateSet({
        name: m.name,
        description: m.description,
        module: 'image',
        category_references: JSON.stringify(m.category_references),
        credit_cost: m.credit_cost,
        params_pricing: JSON.stringify(m.params_pricing ?? []),
        params_schema: JSON.stringify(m.params_schema),
        is_active: true,
      }))
      .execute()
    console.log(`  provider_models seeded (${m.code})`)
  }

  // 11b. veo3.1 视频模型 — 挂在 nano-banana provider 下
  const aspectRatioDefaultArr = [{label: '自适应', value : 'adaptive'}, '16:9', '9:16', '1:1', '4:3', '3:4', '21:9']
  const timeDefaultArr = [
    // { label: '自动', value: -1 },
    { label: '4秒', value: 4 },
    { label: '5秒', value: 5 },
    { label: '6秒', value: 6 },
    { label: '7秒', value: 7 },
    { label: '8秒', value: 8 },
    { label: '10秒', value: 10 },
    { label: '12秒', value: 12 },
    { label: '15秒', value: 15 },
  ]
  const videoVoiceDefaultArr = [
    { label: '有声', value: true, default: true },
    { label: '无声', value: false, default: true },
  ]
  const FRAMES_CATEGORY_REFERENCES = {
    frames: {
      label: '首尾帧',
      limits: {
        image: { min: 1, max: 2 },
        video: { min: 0, max: 0 },
        audio: { min: 0, max: 0 },
        text: { min: 0, max: 0 },
      },
    },
  }

  const MULTIMODAL_AND_FRAMES_CATEGORY_REFERENCES = {
    multimodal: {
      label: '全能参考',
      limits: {
        image: { min: 0, max: 9 },
        video: { min: 0, max: 3 },
        audio: { min: 0, max: 3 },
        text: { min: 0, max: 0 },
      },
    },
    frames: FRAMES_CATEGORY_REFERENCES.frames,
  }

  // const veoVideoModels = [
    // {
    //   code: 'veo3.1-fast',
    //   name: '全能视频3.1 Fast',
    //   description: '快速高质量视频生成',
    //   credit_cost: 10,
    //   category_references: FRAMES_CATEGORY_REFERENCES,
    //   params_pricing: [
    //     { resolution: '720p', model: 'veo3.1-fast', unit_price: 4 },
    //     { resolution: '1080p', model: 'veo3.1-fast', unit_price: 4 },
    //   ],
    //   params_schema: JSON.stringify({
    //     aspect_ratio: aspectRatioDefaultArr,
    //     resolution: ['720p', '1080p'],
    //     time_length: timeDefaultArr,
    //     video_voice: videoVoiceDefaultArr,
    //     image: [],
    //   }),
    // },
    // {
    //   code: 'veo3.1-components',
    //   name: '全能视频3.1',
    //   description: '基于参考图片生成视频',
    //   credit_cost: 15,
    //   params_schema: JSON.stringify({
    //     type: 'object',
    //     properties: {
    //       aspect_ratio: { type: 'string', enum: ['16:9', '9:16', '1:1'] },
    //       image: { type: 'array', items: { type: 'string' } },
    //     },
    //   }),
    // },
  // ]

  // for (const m of veoVideoModels) {
  //   await db
  //     .insertInto('provider_models')
  //     .values({
  //       provider_id: provider.id,
  //       code: m.code,
  //       name: m.name,
  //       description: m.description,
  //       module: 'video',
  //       category_references: JSON.stringify(m.category_references),
  //       credit_cost: m.credit_cost,
  //       params_pricing: JSON.stringify(m.params_pricing ?? []),
  //       params_schema: m.params_schema,
  //       is_active: true,
  //     })
  //     .onConflict((oc: any) => oc.columns(['provider_id', 'code']).doUpdateSet({
  //       name: m.name,
  //       description: m.description,
  //       category_references: JSON.stringify(m.category_references),
  //       credit_cost: m.credit_cost,
  //       params_pricing: JSON.stringify(m.params_pricing ?? []),
  //       params_schema: m.params_schema,
  //       is_active: true,
  //     }))
  //     .execute()
  //   console.log(`  provider_models seeded (${m.code})`)
  // }

  // 12. Volcengine provider + models
  const volcResult = await db
    .insertInto('providers')
    .values({
      code: 'volcengine',
      name: '火山引擎',
      region: 'cn',
      modules: JSON.stringify(['image', 'video']),
      is_active: true,
      config: JSON.stringify({ api_base_url: 'https://ark.cn-beijing.volces.com/api/v3' }),
    })
    .onConflict((oc: any) => oc.column('code').doUpdateSet({
      name: '火山引擎',
      region: 'cn',
      modules: JSON.stringify(['image', 'video']),
      is_active: true,
      config: JSON.stringify({ api_base_url: 'https://ark.cn-beijing.volces.com/api/v3' }),
    }))
    .returningAll()
    .execute()
  const volcProvider = volcResult[0]
  console.log(`  providers seeded (volcengine, id=${volcProvider.id})`)

  const volcImageModels = [
    {
      code: 'seedream-5.0-lite',
      name: 'Seedream 5.0',
      description: '最新火山引擎模型，联网搜索增强',
      credit_cost: 10,
      params_pricing: [
        { resolution: '2k', model: 'seedream-5.0-lite', unit_price: 4 },
        { resolution: '3k', model: 'seedream-5.0-lite', unit_price: 4 },
        { resolution: '4k', model: 'seedream-5.0-lite', unit_price: 4 },
      ],
      params_schema: {
        resolution: ['2k', '3k', '4k'],
        aspect_ratio: ['1:1', '4:3', '3:4', '16:9', '9:16'],
        image: [],
      },
      category_references: SEEDREAM_IMAGE_CATEGORY_REFERENCES,
    },
    {
      code: 'seedream-4.5',
      name: 'Seedream 4.5',
      description: '高分辨率图像生成',
      credit_cost: 10,
      params_pricing: [
        { resolution: '2k', model: 'seedream-4.5', unit_price: 4 },
        { resolution: '4k', model: 'seedream-4.5', unit_price: 4 },
      ],
      params_schema: {
        resolution: ['2k', '4k'],
        aspect_ratio: ['1:1', '4:3', '3:4', '16:9', '9:16'],
        image: [],
      },
      category_references: SEEDREAM_IMAGE_CATEGORY_REFERENCES,
    },
    {
      code: 'seedream-4.0',
      name: 'Seedream 4.0',
      description: '多分辨率图像生成',
      credit_cost: 10,
      params_pricing: [
        { resolution: '1k', model: 'seedream-4.0', unit_price: 3 },
        { resolution: '2k', model: 'seedream-4.0', unit_price: 3 },
        { resolution: '4k', model: 'seedream-4.0', unit_price: 3 },
      ],
      params_schema: {
        resolution: ['1k', '2k', '4k'],
        aspect_ratio: ['1:1', '4:3', '3:4', '16:9', '9:16'],
        image: [],
      },
      category_references: SEEDREAM_IMAGE_CATEGORY_REFERENCES,
    },
  ]

  for (const m of volcImageModels) {
    await db
      .insertInto('provider_models')
      .values({
        provider_id: volcProvider.id,
        code: m.code,
        name: m.name,
        description: m.description,
        module: 'image',
        category_references: JSON.stringify(m.category_references),
        credit_cost: m.credit_cost,
        params_pricing: JSON.stringify(m.params_pricing),
        params_schema: JSON.stringify(m.params_schema),
        is_active: true,
      })
      .onConflict((oc: any) => oc.columns(['provider_id', 'code']).doUpdateSet({
        name: m.name,
        description: m.description,
        module: 'image',
        category_references: JSON.stringify(m.category_references),
        credit_cost: m.credit_cost,
        params_pricing: JSON.stringify(m.params_pricing),
        params_schema: JSON.stringify(m.params_schema),
        is_active: true,
      }))
      .execute()
    console.log(`  provider_models seeded (${m.code})`)
  }

  const volcAspectRatioArr = [{ label: '自适应', value: 'adaptive' }, '16:9', '9:16', '1:1', '4:3', '3:4', '21:9']
  const volcTimeLengthArr = [
    // { label: '自动', value: -1 },
    { label: '4秒', value: 4 },
    { label: '5秒', value: 5 },
    { label: '6秒', value: 6 },
    { label: '7秒', value: 7 },
    { label: '8秒', value: 8 },
    { label: '10秒', value: 10 },
    { label: '12秒', value: 12 },
    { label: '15秒', value: 15 },
  ]
  const volcVideoVoiceArr = [
    { label: '有声', value: true, default: true },
    { label: '无声', value: false, default: true },
  ]

  const volcVideoModels = [
    {
      code: 'seedance-1.5-pro',
      name: 'Seedance 1.5 Pro',
      description: '有声视频生成，支持首尾帧',
      credit_cost: 15,
      category_references: FRAMES_CATEGORY_REFERENCES,
      params_pricing: [
        { resolution: '480p', model: 'seedance-1.5-pro', unit_price: 5 },
        { resolution: '720p', model: 'seedance-1.5-pro', unit_price: 10 },
        { resolution: '1080p', model: 'seedance-1.5-pro', unit_price: 20 },
      ],
      params_schema: JSON.stringify({
        aspect_ratio: volcAspectRatioArr,
        resolution: ['480p', '720p', '1080p'],
        time_length: volcTimeLengthArr,
        video_voice: volcVideoVoiceArr,
        image: [],
      }),
    },
    {
      code: 'seedance-2.0',
      name: 'Seedance 2.0',
      description: '新一代有声视频，支持首尾帧',
      credit_cost: 15,
      category_references: MULTIMODAL_AND_FRAMES_CATEGORY_REFERENCES,
      params_pricing: [
        { resolution: '480p', model: 'seedance-2.0', unit_price: 7 },
        { resolution: '720p', model: 'seedance-2.0', unit_price: 15 },
        { resolution: '1080p', model: 'seedance-2.0', unit_price: 35 },
      ],
      params_schema: JSON.stringify({
        aspect_ratio: volcAspectRatioArr,
        resolution: ['480p', '720p', '1080p'],
        time_length: volcTimeLengthArr,
        video_voice: volcVideoVoiceArr,
        image: [],
      }),
    },
    {
      code: 'seedance-2.0-fast',
      name: 'Seedance 2.0 Fast',
      description: '新一代有声视频，支持首尾帧',
      credit_cost: 15,
      category_references: MULTIMODAL_AND_FRAMES_CATEGORY_REFERENCES,
      params_pricing: [
        { resolution: '480p', model: 'seedance-2.0-fast', unit_price: 5 },
        { resolution: '720p', model: 'seedance-2.0-fast', unit_price: 12 },
      ],
      params_schema: JSON.stringify({
        aspect_ratio: volcAspectRatioArr,
        resolution: ['480p', '720p'],
        time_length: volcTimeLengthArr,
        video_voice: volcVideoVoiceArr,
        image: [],
      }),
    },
  ]

  for (const m of volcVideoModels) {
    await db
      .insertInto('provider_models')
      .values({
        provider_id: volcProvider.id,
        code: m.code,
        name: m.name,
        description: m.description,
        module: 'video',
        category_references: JSON.stringify(m.category_references),
        credit_cost: m.credit_cost,
        params_pricing: JSON.stringify(m.params_pricing),
        params_schema: m.params_schema,
        is_active: true,
      })
      .onConflict((oc: any) => oc.columns(['provider_id', 'code']).doUpdateSet({
        name: m.name,
        description: m.description,
        category_references: JSON.stringify(m.category_references),
        credit_cost: m.credit_cost,
        params_pricing: JSON.stringify(m.params_pricing),
        params_schema: m.params_schema,
        is_active: true,
      }))
      .execute()
    console.log(`  provider_models seeded (${m.code})`)
  }

  const volcSingleModels = [
    { code: 'jimeng_realman_avatar_picture_omni_v15', name: '数字人生成', module: 'avatar' as const, credit_cost: 50 },
    { code: 'jimeng_dreamactor_m20_gen_video', name: '动作模仿', module: 'action_imitation' as const, credit_cost: 20 },
  ]

  for (const m of volcSingleModels) {
    await db
      .insertInto('provider_models')
      .values({
        provider_id: volcProvider.id,
        code: m.code,
        name: m.name,
        module: m.module,
        credit_cost: m.credit_cost,
        params_pricing: JSON.stringify([]),
        params_schema: JSON.stringify({}),
        is_active: true,
      })
      .onConflict((oc: any) => oc.columns(['provider_id', 'code']).doUpdateSet({
        name: m.name,
        credit_cost: m.credit_cost,
        is_active: true,
      }))
      .execute()
    console.log(`  provider_models seeded (${m.code})`)
  }
  console.log('  Volcengine models seeded')

  const murekaApiBaseUrl = process.env.MUREKA_API_URL?.trim()
  const murekaConfig = murekaApiBaseUrl ? { api_base_url: murekaApiBaseUrl } : {}

  const murekaResult = await db
    .insertInto('providers')
    .values({
      code: 'mureka',
      name: 'Mureka',
      region: 'global',
      modules: JSON.stringify(['music', 'music_voice_clone']),
      is_active: true,
      config: JSON.stringify(murekaConfig),
    })
    .onConflict((oc: any) => oc.column('code').doUpdateSet({
      name: 'Mureka',
      region: 'global',
      modules: JSON.stringify(['music', 'music_voice_clone']),
      is_active: true,
      config: JSON.stringify(murekaConfig),
    }))
    .returningAll()
    .execute()
  const murekaProvider = murekaResult[0]
  console.log(`  providers seeded (mureka, id=${murekaProvider.id})`)

  const MUSIC_CATEGORY_REFERENCES = {
    text_to_music: {
      label: '文本生成音乐',
      limits: {
        image: ZERO_REFERENCE_LIMIT,
        video: ZERO_REFERENCE_LIMIT,
        audio: ZERO_REFERENCE_LIMIT,
        text: ZERO_REFERENCE_LIMIT,
      },
    },
    voice_clone_music: {
      label: '克隆音色生成音乐',
      limits: {
        image: ZERO_REFERENCE_LIMIT,
        video: ZERO_REFERENCE_LIMIT,
        audio: { min: 0, max: 1 },
        text: ZERO_REFERENCE_LIMIT,
      },
    },
  }

  const murekaMusicParamsSchema = {
    type: ['song', 'instrumental'],
    mode: ['inspiration', 'custom'],
    styles: [],
    voice_gender: ['auto', 'male', 'female'],
    voice_id: [],
  }

  const murekaMusicModels = [
    {
      code: 'mureka-8',
      name: 'Mureka 8 音乐生成',
      description: '音乐生成模型，覆盖歌词、歌曲、纯音乐、封面和转存成本',
      module: 'music' as const,
      credit_cost: 12,
      category_references: MUSIC_CATEGORY_REFERENCES,
      params_pricing: [
        { resolution: 'lyrics', model: 'mureka-8', unit_price: 2 },
        { resolution: 'song', model: 'mureka-8', unit_price: 8 },
        { resolution: 'instrumental', model: 'mureka-8', unit_price: 8 },
        { resolution: 'cover', model: 'mureka-8', unit_price: 1 },
        { resolution: 'transfer', model: 'mureka-8', unit_price: 1 },
      ],
      params_schema: murekaMusicParamsSchema,
    },
    {
      code: 'mureka-9',
      name: 'Mureka 9 音乐生成',
      description: '高质量音乐生成模型，覆盖歌词、歌曲、纯音乐、封面和转存成本',
      module: 'music' as const,
      credit_cost: 18,
      category_references: MUSIC_CATEGORY_REFERENCES,
      params_pricing: [
        { resolution: 'lyrics', model: 'mureka-9', unit_price: 3 },
        { resolution: 'song', model: 'mureka-9', unit_price: 12 },
        { resolution: 'instrumental', model: 'mureka-9', unit_price: 12 },
        { resolution: 'cover', model: 'mureka-9', unit_price: 1 },
        { resolution: 'transfer', model: 'mureka-9', unit_price: 2 },
      ],
      params_schema: murekaMusicParamsSchema,
    },
  ]

  for (const m of murekaMusicModels) {
    await db
      .insertInto('provider_models')
      .values({
        provider_id: murekaProvider.id,
        code: m.code,
        name: m.name,
        description: m.description,
        module: m.module,
        category_references: m.category_references ? JSON.stringify(m.category_references) : null,
        credit_cost: m.credit_cost,
        params_pricing: JSON.stringify(m.params_pricing),
        params_schema: JSON.stringify(m.params_schema),
        is_active: true,
      })
      .onConflict((oc: any) => oc.columns(['provider_id', 'code']).doUpdateSet({
        name: m.name,
        description: m.description,
        module: m.module,
        category_references: m.category_references ? JSON.stringify(m.category_references) : null,
        credit_cost: m.credit_cost,
        params_pricing: JSON.stringify(m.params_pricing),
        params_schema: JSON.stringify(m.params_schema),
        is_active: true,
      }))
      .execute()
    console.log(`  provider_models seeded (${m.code})`)
  }

  const staleVoiceCloneModelIds = (await db
    .selectFrom('provider_models')
    .select('id')
    .where('provider_id', '=', murekaProvider.id)
    .where('code', 'in', ['mureka-8-voice-clone', 'mureka-9-voice-clone', 'mureka-voice-clone'])
    .execute()).map((row) => row.id)
  if (staleVoiceCloneModelIds.length) {
    await db.deleteFrom('team_model_configs').where('model_id', 'in', staleVoiceCloneModelIds).execute()
    await db.deleteFrom('provider_models').where('id', 'in', staleVoiceCloneModelIds).execute()
  }
  console.log('  stale Mureka voice clone model configs removed')

  const minimaxResult = await db
    .insertInto('providers')
    .values({
      code: 'minimax',
      name: 'MiniMax',
      region: 'cn',
      modules: JSON.stringify(['tts']),
      is_active: true,
      config: JSON.stringify({ api_base_url: 'https://api.minimaxi.com/v1/t2a_v2' }),
    })
    .onConflict((oc: any) => oc.column('code').doUpdateSet({
      name: 'MiniMax',
      region: 'cn',
      modules: JSON.stringify(['tts']),
      is_active: true,
      config: JSON.stringify({ api_base_url: 'https://api.minimaxi.com/v1/t2a_v2' }),
    }))
    .returningAll()
    .execute()
  const minimaxProvider = minimaxResult[0]
  console.log(`  providers seeded (minimax, id=${minimaxProvider.id})`)

  const minimaxTtsModels = [
    {
      code: 'speech-2.8-hd',
      name: 'MiniMax Speech 2.8 HD',
      description: '高清音质文本转语音模型',
      credit_cost: 2,
      params_pricing: [{ resolution: 'default', model: 'speech-2.8-hd', unit_price: 2 }],
    },
    {
      code: 'speech-2.8-turbo',
      name: 'MiniMax Speech 2.8 Turbo',
      description: '快速文本转语音模型',
      credit_cost: 1,
      params_pricing: [{ resolution: 'default', model: 'speech-2.8-turbo', unit_price: 1 }],
    },
  ]

  const minimaxTtsParamsSchema = {
    voice_id: [],
    speed: [0.5, 0.75, 1, 1.25, 1.5, 2],
    volume: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    pitch: [-12, -11, -10, -9, -8, -7, -6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    emotion: [
      { label: '高兴', value: 'happy' },
      { label: '悲伤', value: 'sad' },
      { label: '愤怒', value: 'angry' },
      { label: '害怕', value: 'fearful' },
      { label: '厌恶', value: 'disgusted' },
      { label: '惊讶', value: 'surprised' },
      { label: '中性', value: 'calm' },
      { label: '生动', value: 'fluent' },
      { label: '低语', value: 'whisper' },
    ],
  }

  for (const m of minimaxTtsModels) {
    await db
      .insertInto('provider_models')
      .values({
        provider_id: minimaxProvider.id,
        code: m.code,
        name: m.name,
        description: m.description,
        module: 'tts',
        credit_cost: m.credit_cost,
        params_pricing: JSON.stringify(m.params_pricing),
        params_schema: JSON.stringify(minimaxTtsParamsSchema),
        is_active: true,
      })
      .onConflict((oc: any) => oc.columns(['provider_id', 'code']).doUpdateSet({
        name: m.name,
        description: m.description,
        module: 'tts',
        credit_cost: m.credit_cost,
        params_pricing: JSON.stringify(m.params_pricing),
        params_schema: JSON.stringify(minimaxTtsParamsSchema),
        is_active: true,
      }))
      .execute()
    console.log(`  provider_models seeded (${m.code})`)
  }

  const minimaxSystemVoiceRows = `
中文 (普通话)	male-qn-qingse	青涩青年音色
中文 (普通话)	male-qn-jingying	精英青年音色
中文 (普通话)	male-qn-badao	霸道青年音色
中文 (普通话)	male-qn-daxuesheng	青年大学生音色
中文 (普通话)	female-shaonv	少女音色
中文 (普通话)	female-yujie	御姐音色
中文 (普通话)	female-chengshu	成熟女性音色
中文 (普通话)	female-tianmei	甜美女性音色
中文 (普通话)	male-qn-qingse-jingpin	青涩青年音色-beta
中文 (普通话)	male-qn-jingying-jingpin	精英青年音色-beta
中文 (普通话)	male-qn-badao-jingpin	霸道青年音色-beta
中文 (普通话)	male-qn-daxuesheng-jingpin	青年大学生音色-beta
中文 (普通话)	female-shaonv-jingpin	少女音色-beta
中文 (普通话)	female-yujie-jingpin	御姐音色-beta
中文 (普通话)	female-chengshu-jingpin	成熟女性音色-beta
中文 (普通话)	female-tianmei-jingpin	甜美女性音色-beta
中文 (普通话)	clever_boy	聪明男童
中文 (普通话)	cute_boy	可爱男童
中文 (普通话)	lovely_girl	萌萌女童
中文 (普通话)	cartoon_pig	卡通猪小琪
中文 (普通话)	bingjiao_didi	病娇弟弟
中文 (普通话)	junlang_nanyou	俊朗男友
中文 (普通话)	chunzhen_xuedi	纯真学弟
中文 (普通话)	lengdan_xiongzhang	冷淡学长
中文 (普通话)	badao_shaoye	霸道少爷
中文 (普通话)	tianxin_xiaoling	甜心小玲
中文 (普通话)	qiaopi_mengmei	俏皮萌妹
中文 (普通话)	wumei_yujie	妩媚御姐
中文 (普通话)	diadia_xuemei	嗲嗲学妹
中文 (普通话)	danya_xuejie	淡雅学姐
中文 (普通话)	Chinese (Mandarin)_Reliable_Executive	沉稳高管
中文 (普通话)	Chinese (Mandarin)_News_Anchor	新闻女声
中文 (普通话)	Chinese (Mandarin)_Mature_Woman	傲娇御姐
中文 (普通话)	Chinese (Mandarin)_Unrestrained_Young_Man	不羁青年
中文 (普通话)	Arrogant_Miss	嚣张小姐
中文 (普通话)	Robot_Armor	机械战甲
中文 (普通话)	Chinese (Mandarin)_Kind-hearted_Antie	热心大婶
中文 (普通话)	Chinese (Mandarin)_HK_Flight_Attendant	港普空姐
中文 (普通话)	Chinese (Mandarin)_Humorous_Elder	搞笑大爷
中文 (普通话)	Chinese (Mandarin)_Gentleman	温润男声
中文 (普通话)	Chinese (Mandarin)_Warm_Bestie	温暖闺蜜
中文 (普通话)	Chinese (Mandarin)_Male_Announcer	播报男声
中文 (普通话)	Chinese (Mandarin)_Sweet_Lady	甜美女声
中文 (普通话)	Chinese (Mandarin)_Southern_Young_Man	南方小哥
中文 (普通话)	Chinese (Mandarin)_Wise_Women	阅历姐姐
中文 (普通话)	Chinese (Mandarin)_Gentle_Youth	温润青年
中文 (普通话)	Chinese (Mandarin)_Warm_Girl	温暖少女
中文 (普通话)	Chinese (Mandarin)_Kind-hearted_Elder	花甲奶奶
中文 (普通话)	Chinese (Mandarin)_Cute_Spirit	憨憨萌兽
中文 (普通话)	Chinese (Mandarin)_Radio_Host	电台男主播
中文 (普通话)	Chinese (Mandarin)_Lyrical_Voice	抒情男声
中文 (普通话)	Chinese (Mandarin)_Straightforward_Boy	率真弟弟
中文 (普通话)	Chinese (Mandarin)_Sincere_Adult	真诚青年
中文 (普通话)	Chinese (Mandarin)_Gentle_Senior	温柔学姐
中文 (普通话)	Chinese (Mandarin)_Stubborn_Friend	嘴硬竹马
中文 (普通话)	Chinese (Mandarin)_Crisp_Girl	清脆少女
中文 (普通话)	Chinese (Mandarin)_Pure-hearted_Boy	清澈邻家弟弟
中文 (普通话)	Chinese (Mandarin)_Soft_Girl	柔和少女
中文 (粤语)	Cantonese_ProfessionalHost（F)	专业女主持
中文 (粤语)	Cantonese_GentleLady	温柔女声
中文 (粤语)	Cantonese_ProfessionalHost（M)	专业男主持
中文 (粤语)	Cantonese_PlayfulMan	活泼男声
中文 (粤语)	Cantonese_CuteGirl	可爱女孩
中文 (粤语)	Cantonese_KindWoman	善良女声
英文	Santa_Claus 	Santa Claus
英文	Grinch	Grinch
英文	Rudolph	Rudolph
英文	Arnold	Arnold
英文	Charming_Santa	Charming Santa
英文	Charming_Lady	Charming Lady
英文	Sweet_Girl	Sweet Girl
英文	Cute_Elf	Cute Elf
英文	Attractive_Girl	Attractive Girl
英文	Serene_Woman	Serene Woman
英文	English_Trustworthy_Man	Trustworthy Man
英文	English_Graceful_Lady	Graceful Lady
英文	English_Aussie_Bloke	Aussie Bloke
英文	English_Whispering_girl	Whispering girl
英文	English_Diligent_Man	Diligent Man
英文	English_Gentle-voiced_man	Gentle-voiced man
日文	Japanese_IntellectualSenior	Intellectual Senior
日文	Japanese_DecisivePrincess	Decisive Princess
日文	Japanese_LoyalKnight	Loyal Knight
日文	Japanese_DominantMan	Dominant Man
日文	Japanese_SeriousCommander	Serious Commander
日文	Japanese_ColdQueen	Cold Queen
日文	Japanese_DependableWoman	Dependable Woman
日文	Japanese_GentleButler	Gentle Butler
日文	Japanese_KindLady	Kind Lady
日文	Japanese_CalmLady	Calm Lady
日文	Japanese_OptimisticYouth	Optimistic Youth
日文	Japanese_GenerousIzakayaOwner	Generous Izakaya Owner
日文	Japanese_SportyStudent	Sporty Student
日文	Japanese_InnocentBoy	Innocent Boy
日文	Japanese_GracefulMaiden	Graceful Maiden
韩文	Korean_SweetGirl	Sweet Girl
韩文	Korean_CheerfulBoyfriend	Cheerful Boyfriend
韩文	Korean_EnchantingSister	Enchanting Sister
韩文	Korean_ShyGirl	Shy Girl
韩文	Korean_ReliableSister	Reliable Sister
韩文	Korean_StrictBoss	Strict Boss
韩文	Korean_SassyGirl	Sassy Girl
韩文	Korean_ChildhoodFriendGirl	Childhood Friend Girl
韩文	Korean_PlayboyCharmer	Playboy Charmer
韩文	Korean_ElegantPrincess	Elegant Princess
韩文	Korean_BraveFemaleWarrior	Brave Female Warrior
韩文	Korean_BraveYouth	Brave Youth
韩文	Korean_CalmLady	Calm Lady
韩文	Korean_EnthusiasticTeen	Enthusiastic Teen
韩文	Korean_SoothingLady	Soothing Lady
韩文	Korean_IntellectualSenior	Intellectual Senior
韩文	Korean_LonelyWarrior	Lonely Warrior
韩文	Korean_MatureLady	Mature Lady
韩文	Korean_InnocentBoy	Innocent Boy
韩文	Korean_CharmingSister	Charming Sister
韩文	Korean_AthleticStudent	Athletic Student
韩文	Korean_BraveAdventurer	Brave Adventurer
韩文	Korean_CalmGentleman	Calm Gentleman
韩文	Korean_WiseElf	Wise Elf
韩文	Korean_CheerfulCoolJunior	Cheerful Cool Junior
韩文	Korean_DecisiveQueen	Decisive Queen
韩文	Korean_ColdYoungMan	Cold Young Man
韩文	Korean_MysteriousGirl	Mysterious Girl
韩文	Korean_QuirkyGirl	Quirky Girl
韩文	Korean_ConsiderateSenior	Considerate Senior
韩文	Korean_CheerfulLittleSister	Cheerful Little Sister
韩文	Korean_DominantMan	Dominant Man
韩文	Korean_AirheadedGirl	Airheaded Girl
韩文	Korean_ReliableYouth	Reliable Youth
韩文	Korean_FriendlyBigSister	Friendly Big Sister
韩文	Korean_GentleBoss	Gentle Boss
韩文	Korean_ColdGirl	Cold Girl
韩文	Korean_HaughtyLady	Haughty Lady
韩文	Korean_CharmingElderSister	Charming Elder Sister
韩文	Korean_IntellectualMan	Intellectual Man
韩文	Korean_CaringWoman	Caring Woman
韩文	Korean_WiseTeacher	Wise Teacher
韩文	Korean_ConfidentBoss	Confident Boss
韩文	Korean_AthleticGirl	Athletic Girl
韩文	Korean_PossessiveMan	Possessive Man
韩文	Korean_GentleWoman	Gentle Woman
韩文	Korean_CockyGuy	Cocky Guy
韩文	Korean_ThoughtfulWoman	Thoughtful Woman
韩文	Korean_OptimisticYouth	Optimistic Youth
西班牙文	Spanish_SereneWoman	Serene Woman
西班牙文	Spanish_MaturePartner	Mature Partner
西班牙文	Spanish_CaptivatingStoryteller	Captivating Storyteller
西班牙文	Spanish_Narrator	Narrator
西班牙文	Spanish_WiseScholar	Wise Scholar
西班牙文	Spanish_Kind-heartedGirl	Kind-hearted Girl
西班牙文	Spanish_DeterminedManager	Determined Manager
西班牙文	Spanish_BossyLeader	Bossy Leader
西班牙文	Spanish_ReservedYoungMan	Reserved Young Man
西班牙文	Spanish_ConfidentWoman	Confident Woman
西班牙文	Spanish_ThoughtfulMan	Thoughtful Man
西班牙文	Spanish_Strong-WilledBoy	Strong-willed Boy
西班牙文	Spanish_SophisticatedLady	Sophisticated Lady
西班牙文	Spanish_RationalMan	Rational Man
西班牙文	Spanish_AnimeCharacter	Anime Character
西班牙文	Spanish_Deep-tonedMan	Deep-toned Man
西班牙文	Spanish_Fussyhostess	Fussy hostess
西班牙文	Spanish_SincereTeen	Sincere Teen
西班牙文	Spanish_FrankLady	Frank Lady
西班牙文	Spanish_Comedian	Comedian
西班牙文	Spanish_Debator	Debator
西班牙文	Spanish_ToughBoss	Tough Boss
西班牙文	Spanish_Wiselady	Wise Lady
西班牙文	Spanish_Steadymentor	Steady Mentor
西班牙文	Spanish_Jovialman	Jovial Man
西班牙文	Spanish_SantaClaus	Santa Claus
西班牙文	Spanish_Rudolph	Rudolph
西班牙文	Spanish_Intonategirl	Intonate Girl
西班牙文	Spanish_Arnold	Arnold
西班牙文	Spanish_Ghost	Ghost
西班牙文	Spanish_HumorousElder	Humorous Elder
西班牙文	Spanish_EnergeticBoy	Energetic Boy
西班牙文	Spanish_WhimsicalGirl	Whimsical Girl
西班牙文	Spanish_StrictBoss	Strict Boss
西班牙文	Spanish_ReliableMan	Reliable Man
西班牙文	Spanish_SereneElder	Serene Elder
西班牙文	Spanish_AngryMan	Angry Man
西班牙文	Spanish_AssertiveQueen	Assertive Queen
西班牙文	Spanish_CaringGirlfriend	Caring Girlfriend
西班牙文	Spanish_PowerfulSoldier	Powerful Soldier
西班牙文	Spanish_PassionateWarrior	Passionate Warrior
西班牙文	Spanish_ChattyGirl	Chatty Girl
西班牙文	Spanish_RomanticHusband	Romantic Husband
西班牙文	Spanish_CompellingGirl	Compelling Girl
西班牙文	Spanish_PowerfulVeteran	Powerful Veteran
西班牙文	Spanish_SensibleManager	Sensible Manager
西班牙文	Spanish_ThoughtfulLady	Thoughtful Lady
葡萄牙文	Portuguese_SentimentalLady	Sentimental Lady
葡萄牙文	Portuguese_BossyLeader	Bossy Leader
葡萄牙文	Portuguese_Wiselady	Wise lady
葡萄牙文	Portuguese_Strong-WilledBoy	Strong-willed Boy
葡萄牙文	Portuguese_Deep-VoicedGentleman	Deep-voiced Gentleman
葡萄牙文	Portuguese_UpsetGirl	Upset Girl
葡萄牙文	Portuguese_PassionateWarrior	Passionate Warrior
葡萄牙文	Portuguese_AnimeCharacter	Anime Character
葡萄牙文	Portuguese_ConfidentWoman	Confident Woman
葡萄牙文	Portuguese_AngryMan	Angry Man
葡萄牙文	Portuguese_CaptivatingStoryteller	Captivating Storyteller
葡萄牙文	Portuguese_Godfather	Godfather
葡萄牙文	Portuguese_ReservedYoungMan	Reserved Young Man
葡萄牙文	Portuguese_SmartYoungGirl	Smart Young Girl
葡萄牙文	Portuguese_Kind-heartedGirl	Kind-hearted Girl
葡萄牙文	Portuguese_Pompouslady	Pompous lady
葡萄牙文	Portuguese_Grinch	Grinch
葡萄牙文	Portuguese_Debator	Debator
葡萄牙文	Portuguese_SweetGirl	Sweet Girl
葡萄牙文	Portuguese_AttractiveGirl	Attractive Girl
葡萄牙文	Portuguese_ThoughtfulMan	Thoughtful Man
葡萄牙文	Portuguese_PlayfulGirl	Playful Girl
葡萄牙文	Portuguese_GorgeousLady	Gorgeous Lady
葡萄牙文	Portuguese_LovelyLady	Lovely Lady
葡萄牙文	Portuguese_SereneWoman	Serene Woman
葡萄牙文	Portuguese_SadTeen	Sad Teen
葡萄牙文	Portuguese_MaturePartner	Mature Partner
葡萄牙文	Portuguese_Comedian	Comedian
葡萄牙文	Portuguese_NaughtySchoolgirl	Naughty Schoolgirl
葡萄牙文	Portuguese_Narrator	Narrator
葡萄牙文	Portuguese_ToughBoss	Tough Boss
葡萄牙文	Portuguese_Fussyhostess	Fussy hostess
葡萄牙文	Portuguese_Dramatist	Dramatist
葡萄牙文	Portuguese_Steadymentor	Steady Mentor
葡萄牙文	Portuguese_Jovialman	Jovial Man
葡萄牙文	Portuguese_CharmingQueen	Charming Queen
葡萄牙文	Portuguese_SantaClaus	Santa Claus
葡萄牙文	Portuguese_Rudolph	Rudolph
葡萄牙文	Portuguese_Arnold	Arnold
葡萄牙文	Portuguese_CharmingSanta	Charming Santa
葡萄牙文	Portuguese_CharmingLady	Charming Lady
葡萄牙文	Portuguese_Ghost	Ghost
葡萄牙文	Portuguese_HumorousElder	Humorous Elder
葡萄牙文	Portuguese_CalmLeader	Calm Leader
葡萄牙文	Portuguese_GentleTeacher	Gentle Teacher
葡萄牙文	Portuguese_EnergeticBoy	Energetic Boy
葡萄牙文	Portuguese_ReliableMan	Reliable Man
葡萄牙文	Portuguese_SereneElder	Serene Elder
葡萄牙文	Portuguese_GrimReaper	Grim Reaper
葡萄牙文	Portuguese_AssertiveQueen	Assertive Queen
葡萄牙文	Portuguese_WhimsicalGirl	Whimsical Girl
葡萄牙文	Portuguese_StressedLady	Stressed Lady
葡萄牙文	Portuguese_FriendlyNeighbor	Friendly Neighbor
葡萄牙文	Portuguese_CaringGirlfriend	Caring Girlfriend
葡萄牙文	Portuguese_PowerfulSoldier	Powerful Soldier
葡萄牙文	Portuguese_FascinatingBoy	Fascinating Boy
葡萄牙文	Portuguese_RomanticHusband	Romantic Husband
葡萄牙文	Portuguese_StrictBoss	Strict Boss
葡萄牙文	Portuguese_InspiringLady	Inspiring Lady
葡萄牙文	Portuguese_PlayfulSpirit	Playful Spirit
葡萄牙文	Portuguese_ElegantGirl	Elegant Girl
葡萄牙文	Portuguese_CompellingGirl	Compelling Girl
葡萄牙文	Portuguese_PowerfulVeteran	Powerful Veteran
葡萄牙文	Portuguese_SensibleManager	Sensible Manager
葡萄牙文	Portuguese_ThoughtfulLady	Thoughtful Lady
葡萄牙文	Portuguese_TheatricalActor	Theatrical Actor
葡萄牙文	Portuguese_FragileBoy	Fragile Boy
葡萄牙文	Portuguese_ChattyGirl	Chatty Girl
葡萄牙文	Portuguese_Conscientiousinstructor	Conscientious Instructor
葡萄牙文	Portuguese_RationalMan	Rational Man
葡萄牙文	Portuguese_WiseScholar	Wise Scholar
葡萄牙文	Portuguese_FrankLady	Frank Lady
葡萄牙文	Portuguese_DeterminedManager	Determined Manager
法文	French_Male_Speech_New	Level-Headed Man
法文	French_Female_News Anchor	Patient Female Presenter
法文	French_CasualMan	Casual Man
法文	French_MovieLeadFemale	Movie Lead Female
法文	French_FemaleAnchor	Female Anchor
法文	French_MaleNarrator	Male Narrator
印尼文	Indonesian_SweetGirl	Sweet Girl
印尼文	Indonesian_ReservedYoungMan	Reserved Young Man
印尼文	Indonesian_CharmingGirl	Charming Girl
印尼文	Indonesian_CalmWoman	Calm Woman
印尼文	Indonesian_ConfidentWoman	Confident Woman
印尼文	Indonesian_CaringMan	Caring Man
印尼文	Indonesian_BossyLeader	Bossy Leader
印尼文	Indonesian_DeterminedBoy	Determined Boy
印尼文	Indonesian_GentleGirl	Gentle Girl
德文	German_FriendlyMan	Friendly Man
德文	German_SweetLady	Sweet Lady
德文	German_PlayfulMan	Playful Man
俄文	Russian_HandsomeChildhoodFriend	Handsome Childhood Friend
俄文	Russian_BrightHeroine	Bright Queen
俄文	Russian_AmbitiousWoman	Ambitious Woman
俄文	Russian_ReliableMan	Reliable Man
俄文	Russian_CrazyQueen	Crazy Girl
俄文	Russian_PessimisticGirl	Pessimistic Girl
俄文	Russian_AttractiveGuy	Attractive Guy
俄文	Russian_Bad-temperedBoy	Bad-tempered Boy
意大利文	Italian_BraveHeroine	Brave Heroine
意大利文	Italian_Narrator	Narrator
意大利文	Italian_WanderingSorcerer	Wandering Sorcerer
意大利文	Italian_DiligentLeader	Diligent Leader
阿拉伯文	Arabic_CalmWoman	Calm Woman
阿拉伯文	Arabic_FriendlyGuy	Friendly Guy
土耳其文	Turkish_CalmWoman	Calm Woman
土耳其文	Turkish_Trustworthyman	Trustworthy man
乌克兰文	Ukrainian_CalmWoman	Calm Woman
乌克兰文	Ukrainian_WiseScholar	Wise Scholar
荷兰文	Dutch_kindhearted_girl	Kind-hearted girl
荷兰文	Dutch_bossy_leader	Bossy leader
越南文	Vietnamese_kindhearted_girl	Kind-hearted girl
泰文	Thai_male_1_sample8	Serene Man
泰文	Thai_male_2_sample2	Friendly Man
泰文	Thai_female_1_sample1	Confident Woman
泰文	Thai_female_2_sample2	Energetic Woman
波兰文	Polish_male_1_sample4	Male Narrator
波兰文	Polish_male_2_sample3	Male Anchor
波兰文	Polish_female_1_sample1	Calm Woman
波兰文	Polish_female_2_sample3	Casual Woman
罗马尼亚文	Romanian_male_1_sample2	Reliable Man
罗马尼亚文	Romanian_male_2_sample1	Energetic Youth
罗马尼亚文	Romanian_female_1_sample4	Optimistic Youth
罗马尼亚文	Romanian_female_2_sample1	Gentle Woman
希腊文	greek_male_1a_v1	Thoughtful Mentor
希腊文	Greek_female_1_sample1	Gentle Lady
希腊文	Greek_female_2_sample3	Girl Next Door
捷克文	czech_male_1_v1	Assured Presenter
捷克文	czech_female_5_v7	Steadfast Narrator
捷克文	czech_female_2_v2	Elegant Lady
芬兰文	finnish_male_3_v1	Upbeat Man
芬兰文	finnish_male_1_v2	Friendly Boy
芬兰文	finnish_female_4_v1	Assetive Woman
印地文	hindi_male_1_v2	Trustworthy Advisor
印地文	hindi_female_2_v1	Tranquil Woman
印地文	hindi_female_1_v2	News Anchor
  `.trim().split('\n').map((row, index) => {
    const [language, voiceId, name] = row.split('\t')
    return {
      language,
      voiceId,
      name,
      metadata: { source_index: index + 1 },
    }
  })

  for (const voice of minimaxSystemVoiceRows) {
    await db
      .insertInto('provider_system_voices')
      .values({
        provider_id: minimaxProvider.id,
        voice_id: voice.voiceId,
        name: voice.name,
        language: voice.language,
        metadata: JSON.stringify(voice.metadata),
        is_active: true,
      })
      .onConflict((oc: any) => oc.columns(['provider_id', 'voice_id']).doUpdateSet({
        name: voice.name,
        language: voice.language,
        metadata: JSON.stringify(voice.metadata),
        is_active: true,
      }))
      .execute()
  }
  console.log(`  provider_system_voices seeded (minimax, ${minimaxSystemVoiceRows.length} voices)`)

  // 13. Prompt filter rule (keyword example) — skip if pattern exists
  const existingRule = await db
    .selectFrom('prompt_filter_rules')
    .selectAll()
    .where('pattern', '=', '违禁词示例')
    .executeTakeFirst()

  if (!existingRule) {
    await db
      .insertInto('prompt_filter_rules')
      .values({
        pattern: '违禁词示例',
        type: 'keyword',
        action: 'reject',
        description: 'Phase 0 测试用敏感词规则',
        is_active: true,
      })
      .execute()
  }
  console.log('  prompt_filter_rules seeded')

  await closeDb()
  console.log('  Seed complete')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
