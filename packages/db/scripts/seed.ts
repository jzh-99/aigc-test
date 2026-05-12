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

  // 9. Provider: Nano Banana — upsert by code
  const providerResult = await db
    .insertInto('providers')
    .values({
      code: 'nano-banana',
      name: 'Nano Banana',
      region: 'global',
      modules: JSON.stringify(['image']),
      is_active: true,
      config: JSON.stringify({
        api_base_url:
          process.env.NANO_BANANA_API_URL ?? '',
      }),
    })
    .onConflict((oc: any) => oc.column('code').doUpdateSet({
      name: 'Nano Banana',
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
  console.log('  providers seeded (nano-banana)')

  // 10. Provider models: nano-banana 图片模型 — upsert by code
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
    },
    {
      code: 'seedream-5.0-lite',
      name: 'Seedream 5.0',
      description: '最新火山引擎模型，联网搜索增强',
      credit_cost: 10,
      params_pricing: [
        { resolution: '2k', model: 'seedream-5.0-lite', unit_price: 4 },
        { resolution: '3k', model: 'seedream-5.0-lite', unit_price: 4 },
      ],
      params_schema: {
        resolution: ['2k', '3k'],
        aspect_ratio: ['1:1', '4:3', '3:4', '16:9', '9:16'],
        image: [],
      },
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
        credit_cost: m.credit_cost,
        params_pricing: JSON.stringify((m.params_pricing ?? [])),
        params_schema: JSON.stringify(m.params_schema),
        is_active: true,
      })
      .onConflict((oc: any) => oc.columns(['provider_id', 'code']).doUpdateSet({
        name: m.name,
        description: m.description,
        module: 'image',
        credit_cost: m.credit_cost,
        params_pricing: JSON.stringify(m.params_pricing ?? []),
        params_schema: JSON.stringify(m.params_schema),
        is_active: true,
      }))
      .execute()
    console.log(`  provider_models seeded (${m.code})`)
  }

  // 10b. veo3.1 视频模型 — 挂在 nano-banana provider 下
  const aspectRatioDefaultArr = [{label: '自适应', value : 'adaptive'}, '16:9', '9:16', '1:1', '4:3', '3:4', '21:9']
  const timeDefaultArr = [
    { label: '自动', value: -1 },
    { label: '4秒', value: 4 },
    { label: '5秒', value: 4 },
    { label: '6秒', value: 4 },
    { label: '7秒', value: 4 },
    { label: '8秒', value: 4 },
    { label: '10秒', value: 4 },
    { label: '12秒', value: 4 },
    { label: '15秒', value: 4 },
  ]
  const videoVoiceDefaultArr = [
    { label: '有声', value: true, default: true },
    { label: '无声', value: false, default: true },
  ]
  const veoVideoModels = [
    {
      code: 'veo3.1-fast',
      name: '全能视频3.1 Fast',
      description: '快速高质量视频生成',
      credit_cost: 10,
      video_categories: ['frames'],
      params_pricing: [
        { resolution: '720p', model: 'veo3.1-fast', unit_price: 4 },
        { resolution: '1080p', model: 'veo3.1-fast', unit_price: 4 },
      ],
      params_schema: JSON.stringify({
        aspect_ratio: aspectRatioDefaultArr,
        resolution: ['720p', '1080p'],
        time_length: timeDefaultArr,
        video_voice: videoVoiceDefaultArr,
        image: [],
      }),
    },
    // {
    //   code: 'veo3.1-components',
    //   name: '全能视频3.1',
    //   description: '基于参考图片生成视频',
    //   credit_cost: 15,
    //   video_categories: ['components'],
    //   params_schema: JSON.stringify({
    //     type: 'object',
    //     properties: {
    //       aspect_ratio: { type: 'string', enum: ['16:9', '9:16', '1:1'] },
    //       image: { type: 'array', items: { type: 'string' } },
    //     },
    //   }),
    // },
    {
      code: 'seedance-1.5-pro',
      name: 'Seedance 1.5 Pro',
      description: '有声视频生成，支持首尾帧',
      credit_cost: 15,
      video_categories: ['frames'],
      params_pricing: [
        { resolution: '480p', model: 'seedance-1.5-pro', unit_price: 5 },
        { resolution: '720p', model: 'seedance-1.5-pro', unit_price: 10 },
        { resolution: '1080p', model: 'seedance-1.5-pro', unit_price: 20 },
      ],
      params_schema: JSON.stringify({
        aspect_ratio: aspectRatioDefaultArr,
        resolution: ['480p', '720p', '1080p'],
        time_length: timeDefaultArr,
        video_voice: videoVoiceDefaultArr,
        image: [],
      }),
    },
    {
      code: 'seedance-2.0',
      name: 'Seedance 2.0',
      description: '新一代有声视频，支持首尾帧',
      credit_cost: 15,
      video_categories: ['multimodal', 'frames', 'components'],
      params_pricing: [
        { resolution: '480p', model: 'seedance-2.0', unit_price: 7 },
        { resolution: '720p', model: 'seedance-2.0', unit_price: 15 },
        { resolution: '1080p', model: 'seedance-2.0', unit_price: 35 },
      ],
      params_schema: JSON.stringify({
        aspect_ratio: aspectRatioDefaultArr,
        resolution: ['480p', '720p', '1080p'],
        time_length: timeDefaultArr,
        video_voice: videoVoiceDefaultArr,
        image: [],
      }),
    },
    {
      code: 'seedance-2.0-fast',
      name: 'Seedance 2.0 Fast',
      description: '新一代有声视频，支持首尾帧',
      credit_cost: 15,
      video_categories: ['multimodal', 'frames', 'components'],
      params_pricing: [
        { resolution: '480p', model: 'seedance-2.0-fast', unit_price: 5 },
        { resolution: '720p', model: 'seedance-2.0-fast', unit_price: 12 },
      ],
      params_schema: JSON.stringify({
        aspect_ratio: aspectRatioDefaultArr,
        resolution: ['480p', '720p'],
        time_length: timeDefaultArr,
        video_voice: videoVoiceDefaultArr,
        image: [],
      }),
    },
  ]

  for (const m of veoVideoModels) {
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
        params_pricing: JSON.stringify(m.params_pricing ?? []),
        params_schema: m.params_schema,
        is_active: true,
      })
      .onConflict((oc: any) => oc.columns(['provider_id', 'code']).doUpdateSet({
        name: m.name,
        description: m.description,
        video_categories: JSON.stringify(m.video_categories),
        credit_cost: m.credit_cost,
        params_pricing: JSON.stringify(m.params_pricing ?? []),
        params_schema: m.params_schema,
        is_active: true,
      }))
      .execute()
    console.log(`  provider_models seeded (${m.code})`)
  }

  // 11. Prompt filter rule (keyword example) — skip if pattern exists
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
