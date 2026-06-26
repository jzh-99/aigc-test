/**
 * 全局数据重置 + 重新 seed 脚本。
 *
 * 用途（见 2026-06-26 业管先行登录改造方案）：
 * 业管硬切换后的一次性运维操作。清空所有"用户业务数据"（含 seed 创建的用户、团队、
 * 工作区、业管绑定、任务、资产、流水等），然后重新跑 seed 恢复系统配置类数据。
 *
 * 清理边界：
 * - 【清空】所有与用户绑定的业务表（users/teams/workspaces/tasks/assets/业管表/会话表等）。
 * - 【保留】系统配置类表（providers/provider_models/provider_system_voices/
 *   system_cost_configs/prompt_filter_rules/subscription_plans），这些与用户无关，
 *   重新 seed 会按 onConflict 更新，无需清空。
 *
 * 实现：在单个事务内用 TRUNCATE ... CASCADE 一次性清空所有用户业务表。
 * PostgreSQL 允许在一条 TRUNCATE 里列出多表，会自动处理外键依赖（含 NO ACTION），
 * 比 DELETE 逐表删快得多，且能重置自增序列。
 *
 * 运行：pnpm db:reset（等价于先 TRUNCATE 再 pnpm db:seed）
 */
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from 'dotenv'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
config({ path: path.resolve(__dirname, '../../../.env') })

import { sql } from 'kysely'
import { getDb, closeDb } from '../src/client.js'

// 所有需要清空的用户业务表（按业务分组列出，TRUNCATE 会统一处理外键依赖）。
// 注意：不要把系统配置类表（providers 等）放进这里。
const USER_BUSINESS_TABLES = [
  // ── 业管侧 ──
  'biz_mgmt_outbox_events', // 无 FK，但含 local_user_id
  'biz_mgmt_a_bean_transactions', // CASCADE on users
  'biz_mgmt_member_bindings', // CASCADE on users
  // ── 创作项目 ──
  'short_drama_segments', // 依赖 short_drama_projects
  'picture_book_project_charges',
  'picture_book_projects',
  'short_drama_projects',
  'music_voice_clones',
  'music_tracks',
  'video_studio_projects',
  'canvas_agent_sessions', // 依赖 canvases
  'canvas_node_outputs', // 依赖 canvases
  'canvases',
  // ── 任务链 ──
  'assets',
  'tasks',
  'task_batches',
  // ── 团队/工作区 ──
  'workspace_members',
  'workspaces',
  'team_members',
  'teams',
  // ── 认证/会话/邀请 ──
  'refresh_tokens',
  'email_verifications',
  'user_subscriptions',
  // ── 其他用户关联表 ──
  'prompt_filter_logs',
  'payment_orders',
  'voice_profiles',
  'provider_api_logs',
  'mini_user_push_rules',
  'mini_user_auth_records',
  'api_clients',
  // ── 最后是 users（被众多表引用，TRUNCATE 多表会统一处理）──
  'users',
] as const

async function main() {
  const db = getDb()

  console.log('⚠️  即将清空所有用户业务数据（不可逆）...')
  console.log(`   涉及 ${USER_BUSINESS_TABLES.length} 张表`)

  // 用 TRUNCATE 一次性清空所有表 + 重置序列。
  // CASCADE 确保清理掉所有引用这些表的外键依赖（如 canvas_node_outputs 引用 canvases）。
  // 由于 users 在列表内，所有引用 users.id 的表都会被连带清空。
  const tableList = USER_BUSINESS_TABLES.join(', ')
  await sql`TRUNCATE TABLE ${sql.raw(tableList)} RESTART IDENTITY CASCADE`.execute(db)

  console.log('✅ 用户业务数据已清空')
  console.log('')
  console.log('系统配置类表已保留（providers/provider_models/voices/cost_configs/rules/plans），')
  console.log('如需刷新配置请单独执行 pnpm db:seed。')
  console.log('')
  console.log('下一步：执行 pnpm db:seed 恢复 seed 数据。')
}

main()
  .then(() => closeDb())
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ 重置失败：', err)
    closeDb().finally(() => process.exit(1))
  })
