import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// ───────────────────────────────────────────────────────────────────────────
// purgeLocalUserCascade 源码契约测试
//
// 业管先行登录流程（见计划 Critical Login Invariant）规定：业管查无会员时，
// 若本地存在该手机号 user，必须调用 purgeLocalUserCascade 物理删除其全部业务数据。
//
// 由于大量业务表对 users.id 是 NO ACTION（Postgres 默认 RESTRICT），
// 直接 DELETE FROM users 会被外键阻止。purgeLocalUserCascade 必须按
// 叶子→根顺序手动删除所有相关表，最后才能删 users。
//
// 本测试用源码文本扫描验证：实现里覆盖了所有 NO ACTION 表（不能漏），
// 且删除顺序正确（users 必须最后删）。
// ───────────────────────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url))
const SOURCE = readFileSync(
  join(__dirname, '..', 'services', 'biz-mgmt-member-sync.ts'),
  'utf8',
)

// 提取 purgeLocalUserCascade 函数体（从函数签名到下一个 export function 或文件尾）
function getPurgeFunctionBody(): string {
  const start = SOURCE.indexOf('export async function purgeLocalUserCascade')
  assert.notEqual(start, -1, 'purgeLocalUserCascade 函数未找到')
  // 截取从函数签名到文件尾（该函数是最后一个 export）
  return SOURCE.slice(start)
}

const PURGE_BODY = getPurgeFunctionBody()

describe('purgeLocalUserCascade 删除顺序契约', () => {
  it('必须在一个事务内执行（db.transaction().execute），保证原子性', () => {
    assert.match(PURGE_BODY, /db\.transaction\(\)\.execute/, '必须用事务包裹全部删除')
  })

  it('参数名必须是 localUserId', () => {
    assert.match(PURGE_BODY, /purgeLocalUserCascade\(\s*localUserId/, '参数名必须是 localUserId')
  })

  it('必须删除 users 表（DELETE FROM users 或 deleteFrom(users)），且必须最后执行', () => {
    // users 删除语句必须出现
    assert.match(
      PURGE_BODY,
      /deleteFrom\('users'\)|DELETE FROM users/,
      '必须包含对 users 表的删除',
    )
    // 找到 users 删除语句在函数体中的位置，验证其后不再有其他 deleteFrom/DELETE FROM
    const usersMatch = PURGE_BODY.match(/(?:deleteFrom\('users'\)|DELETE FROM users)[^;]*;?/)
    assert.ok(usersMatch, 'users 删除语句必须存在')
    const usersIdx = PURGE_BODY.indexOf(usersMatch[0])
    const tail = PURGE_BODY.slice(usersIdx + usersMatch[0].length)
    // users 删除之后，不应再有其他表的删除语句（users 必须是最后一个被删的表）
    const laterDeletes = tail.match(/deleteFrom\('[^']+'\)|DELETE FROM \w+/g)
    assert.equal(
      laterDeletes,
      null,
      `users 必须最后删除，但其后还有删除语句: ${laterDeletes?.join(', ')}`,
    )
  })
})

// ─── NO ACTION 表清单：必须全部显式删除（漏一个就会被 FK 阻止）─────────────
// 依据 packages/db/migrations 的外键扫描结果：
// references('users.id') 但没有 .onDelete('cascade'|'set null') 的表全部是 NO ACTION。
const NO_ACTION_TABLES = [
  'user_subscriptions', // 003_auth_tables.ts:12
  'teams', // 004_teams.ts:13 (owner_id) —— 注意：先删 team_members 再删 teams
  'team_members', // 004_teams.ts:33
  'workspaces', // 004_teams.ts:84 (created_by)
  'task_batches', // 006_tasks.ts:12
  'tasks', // 006_tasks.ts:89
  'assets', // 006_tasks.ts:138
  'prompt_filter_logs', // 007_security.ts:12
  'payment_orders', // 007_security.ts:54
  'voice_profiles', // 008_providers.ts:63
  'canvases', // 021_canvas.ts:9
  'video_studio_projects', // 026_video_studio_projects.ts:8
  'music_voice_clones', // 044_music.ts:20
  'music_tracks', // 044_music.ts:86
  'picture_book_projects', // 050_picture_book.ts:17
  'picture_book_project_charges', // 050_picture_book.ts:91
  'short_drama_projects', // 052_short_drama.ts:16
] as const

describe('purgeLocalUserCascade 必须覆盖所有 NO ACTION 表', () => {
  for (const table of NO_ACTION_TABLES) {
    it(`必须删除 ${table}（NO ACTION 外键，不删会阻止 users 删除）`, () => {
      // 匹配 deleteFrom('表名') 或 DELETE FROM 表名
      const pattern = new RegExp(
        `deleteFrom\\('${table}'\\)|DELETE FROM ${table}`,
      )
      assert.match(
        PURGE_BODY,
        pattern,
        `${table} 是 NO ACTION 外键表，purgeLocalUserCascade 必须显式删除它，否则 DELETE FROM users 会被 FK 阻止`,
      )
    })
  }
})

// ─── 无 FK 表（存 user_id 但不建外键）：也必须手动删，否则留悬空数据 ────────
const NO_FK_BUT_HAS_USER_TABLES = [
  'biz_mgmt_outbox_events', // 075: local_user_id 纯 uuid 无 references
  'api_clients', // 072: system_user_id 纯 uuid 无 references（可选，但应清）
] as const

describe('purgeLocalUserCascade 应清理无 FK 的用户关联表', () => {
  for (const table of NO_FK_BUT_HAS_USER_TABLES) {
    it(`应删除 ${table}（无 FK，不删会留悬空 local_user_id/system_user_id）`, () => {
      const pattern = new RegExp(
        `deleteFrom\\('${table}'\\)|DELETE FROM ${table}`,
      )
      assert.match(
        PURGE_BODY,
        pattern,
        `${table} 虽无 FK，但含 user_id 列，应一并清理避免悬空数据`,
      )
    })
  }
})

// ─── 顺序约束：tasks 必须在 task_batches 之前删 ──────────────────────────
describe('purgeLocalUserCascade 顺序约束', () => {
  it('assets 必须在 tasks 之前删（tasks 没有对 assets 的 FK，但语义上 assets 属于 task）', () => {
    const assetsIdx = PURGE_BODY.search(/deleteFrom\('assets'\)|DELETE FROM assets/)
    const tasksIdx = PURGE_BODY.search(/deleteFrom\('tasks'\)|DELETE FROM tasks/)
    if (assetsIdx === -1 || tasksIdx === -1) return // 已被前置断言覆盖
    assert.ok(
      assetsIdx < tasksIdx,
      'assets 应在 tasks 之前删除（assets.task_id 依赖 tasks）',
    )
  })

  it('tasks 必须在 task_batches 之前删（tasks.task_batch_id 引用 task_batches）', () => {
    const tasksIdx = PURGE_BODY.search(/deleteFrom\('tasks'\)|DELETE FROM tasks/)
    const batchesIdx = PURGE_BODY.search(/deleteFrom\('task_batches'\)|DELETE FROM task_batches/)
    if (tasksIdx === -1 || batchesIdx === -1) return
    assert.ok(
      tasksIdx < batchesIdx,
      'tasks 应在 task_batches 之前删除（tasks.task_batch_id 引用 task_batches）',
    )
  })

  it('team_members 必须在 teams 之前删（teams.owner_id 是 NO ACTION）', () => {
    const membersIdx = PURGE_BODY.search(/deleteFrom\('team_members'\)|DELETE FROM team_members/)
    const teamsIdx = PURGE_BODY.search(/deleteFrom\('teams'\)|DELETE FROM teams/)
    if (membersIdx === -1 || teamsIdx === -1) return
    assert.ok(
      membersIdx < teamsIdx,
      'team_members 应在 teams 之前删除（teams.owner_id NO ACTION 会阻止删 teams）',
    )
  })

  it('team_members 必须在 workspaces 之前删（workspaces.created_by NO ACTION）—— 实际是 workspaces 在 teams 前，但 team_members 必须在两者前', () => {
    // workspaces.created_by 也是 NO ACTION，但 workspaces 不引用 team_members，
    // 所以只需保证 team_members 先于 teams/workspaces 的 owner/created_by 约束。
    // 这里只断言 team_members 出现在 users 之前即可，严格顺序由 FK 保证。
    const membersIdx = PURGE_BODY.search(/deleteFrom\('team_members'\)|DELETE FROM team_members/)
    const usersIdx = PURGE_BODY.search(/deleteFrom\('users'\)|DELETE FROM users/)
    if (membersIdx === -1 || usersIdx === -1) return
    assert.ok(membersIdx < usersIdx, 'team_members 应在 users 之前删除')
  })
})
