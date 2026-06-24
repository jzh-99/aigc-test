import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

/**
 * Task 0.1 开放接口表结构与枚举扩展迁移测试
 *
 * 与现有迁移测试惯例一致（参考 batch-source-migration.test.ts）：
 * 不连真实 PG，仅断言迁移文件源码片段，保证结构/约束/索引/枚举正确。
 */
describe('071_open_api_tables migration', () => {
  const migrationPath = join(__dirname, '../migrations/071_open_api_tables.ts')
  let content = ''

  test('迁移文件存在', async () => {
    content = await readFile(migrationPath, 'utf-8')
    assert.ok(content.length > 0)
  })

  test('up 函数存在', async () => {
    content = await readFile(migrationPath, 'utf-8')
    assert.ok(content.includes('export async function up'))
  })

  test('down 函数存在', async () => {
    content = await readFile(migrationPath, 'utf-8')
    assert.ok(content.includes('export async function down'))
  })

  // ─── task_batches 新增字段 ──────────────────────────────────────────────
  test('task_batches 新增 business_id 列（内部规范拼写）', async () => {
    content = await readFile(migrationPath, 'utf-8')
    assert.ok(content.includes("addColumn('business_id'"))
    assert.ok(/varchar\(50\)/i.test(content))
  })

  test('task_batches 新增 callback_url 列', async () => {
    content = await readFile(migrationPath, 'utf-8')
    assert.ok(content.includes("addColumn('callback_url'"))
  })

  test('task_batches 新增 callback_attempts 列，默认 0 且 NOT NULL', async () => {
    content = await readFile(migrationPath, 'utf-8')
    assert.ok(content.includes("addColumn('callback_attempts'"))
    assert.ok(content.includes('integer'))
    assert.ok(/notNull\(\)/.test(content))
    assert.ok(/defaultTo\(0\)/.test(content))
  })

  test('task_batches 新增 callback_status 列', async () => {
    content = await readFile(migrationPath, 'utf-8')
    assert.ok(content.includes("addColumn('callback_status'"))
  })

  test('task_batches 新增 service_type 列', async () => {
    content = await readFile(migrationPath, 'utf-8')
    assert.ok(content.includes("addColumn('service_type'"))
  })

  test('task_batches 新增 task_id 列（对外契约 task_id）', async () => {
    content = await readFile(migrationPath, 'utf-8')
    assert.ok(content.includes("addColumn('task_id'"))
  })

  test('task_batches 新增 finished_at 列', async () => {
    content = await readFile(migrationPath, 'utf-8')
    assert.ok(content.includes("addColumn('finished_at'"))
    assert.ok(/timestamptz/i.test(content))
  })

  // ─── tasks 新增外部轮询字段 ─────────────────────────────────────────────
  test('tasks 新增 external_status 列', async () => {
    content = await readFile(migrationPath, 'utf-8')
    assert.ok(content.includes("alterTable('tasks')"))
    assert.ok(content.includes("addColumn('external_status'"))
  })

  test('tasks 新增 last_polled_at 列', async () => {
    content = await readFile(migrationPath, 'utf-8')
    assert.ok(content.includes("addColumn('last_polled_at'"))
    assert.ok(/timestamptz/i.test(content))
  })

  // ─── 枚举约束扩展 ───────────────────────────────────────────────────────
  test('扩展 source 约束包含 open_api', async () => {
    content = await readFile(migrationPath, 'utf-8')
    assert.ok(content.includes('chk_tb_source'))
    assert.ok(/open_api/.test(content))
    // 保留原有枚举值
    assert.ok(content.includes("'generation'"))
    assert.ok(content.includes("'studio'"))
    assert.ok(content.includes("'canvas'"))
  })

  test('扩展 module 约束包含 podcast/news/storybook', async () => {
    content = await readFile(migrationPath, 'utf-8')
    assert.ok(content.includes('chk_tb_module'))
    assert.ok(content.includes("'podcast'"))
    assert.ok(content.includes("'news'"))
    assert.ok(content.includes("'storybook'"))
    // 保留 064 已有的 text
    assert.ok(content.includes("'text'"))
  })

  // ─── api_clients 新建表 ────────────────────────────────────────────────
  test('创建 api_clients 表', async () => {
    content = await readFile(migrationPath, 'utf-8')
    assert.ok(content.includes("createTable('api_clients')"))
  })

  test('api_clients 含 id 主键（uuid 默认值）', async () => {
    content = await readFile(migrationPath, 'utf-8')
    assert.ok(content.includes("addColumn('id'"))
    assert.ok(/primaryKey\(\)/.test(content))
    assert.ok(/gen_random_uuid/.test(content))
  })

  test('api_clients 含 name 列且唯一非空', async () => {
    content = await readFile(migrationPath, 'utf-8')
    assert.ok(content.includes("addColumn('name'"))
    assert.ok(/notNull\(\)/.test(content))
    assert.ok(/unique\(\)/.test(content))
  })

  test('api_clients 含 api_key_hash 列且唯一非空', async () => {
    content = await readFile(migrationPath, 'utf-8')
    assert.ok(content.includes("addColumn('api_key_hash'"))
    assert.ok(/notNull\(\)/.test(content))
    assert.ok(/unique\(\)/.test(content))
  })

  test('api_clients 含 status 列，默认 active', async () => {
    content = await readFile(migrationPath, 'utf-8')
    assert.ok(content.includes("addColumn('status'"))
    assert.ok(/defaultTo\('active'\)/.test(content))
  })

  test('api_clients 含 team_id / workspace_id / system_user_id 归属字段', async () => {
    content = await readFile(migrationPath, 'utf-8')
    assert.ok(content.includes("addColumn('team_id'"))
    assert.ok(content.includes("addColumn('workspace_id'"))
    assert.ok(content.includes("addColumn('system_user_id'"))
  })

  test('api_clients 含 created_at / updated_at 默认 now()', async () => {
    content = await readFile(migrationPath, 'utf-8')
    assert.ok(content.includes("addColumn('created_at'"))
    assert.ok(content.includes("addColumn('updated_at'"))
    assert.ok(/now\(\)/.test(content))
  })

  // ─── down 回滚 ─────────────────────────────────────────────────────────
  test('down 删除 api_clients 表', async () => {
    content = await readFile(migrationPath, 'utf-8')
    assert.ok(content.includes("dropTable('api_clients')"))
  })

  test('down 删除 tasks 新增列', async () => {
    content = await readFile(migrationPath, 'utf-8')
    assert.ok(/dropColumn\('external_status'\)/.test(content))
    assert.ok(/dropColumn\('last_polled_at'\)/.test(content))
  })

  test('down 删除 task_batches 新增列', async () => {
    content = await readFile(migrationPath, 'utf-8')
    assert.ok(/dropColumn\('finished_at'\)/.test(content))
    assert.ok(/dropColumn\('task_id'\)/.test(content))
    assert.ok(/dropColumn\('service_type'\)/.test(content))
    assert.ok(/dropColumn\('callback_status'\)/.test(content))
    assert.ok(/dropColumn\('callback_attempts'\)/.test(content))
    assert.ok(/dropColumn\('callback_url'\)/.test(content))
    assert.ok(/dropColumn\('business_id'\)/.test(content))
  })

  test('down 恢复 source / module 约束为迁移前状态', async () => {
    content = await readFile(migrationPath, 'utf-8')
    // down 段需重新重建约束（剔除 open_api 与 podcast/news/storybook）
    const downIdx = content.indexOf('export async function down')
    const downSection = content.slice(downIdx)
    assert.ok(downSection.includes('chk_tb_source'))
    assert.ok(downSection.includes('chk_tb_module'))
  })
})
