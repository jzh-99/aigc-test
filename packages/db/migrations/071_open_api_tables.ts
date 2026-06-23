import type { Kysely } from 'kysely'
import { sql } from 'kysely'

/**
 * 071_open_api_tables.ts
 *
 * 开放接口（Open API）迁移：
 * 1. task_batches 新增回调与对外契约字段（business_id / callback_* / service_type / task_id / finished_at）
 *    —— 内部 DB 列名采用规范拼写 business_id，路由层做 bussiness_id ↔ business_id 映射（对客户端零改动）
 * 2. tasks 新增外部任务轮询载荷（external_status / last_polled_at）
 * 3. 新建 api_clients 表：开放接口调用方（API Key 哈希 + 归属团队/工作区/系统用户）
 * 4. 扩展 task_batches.source / module 枚举约束，支持开放接口新业务模块
 *
 * 约束列表必须覆盖现有全部枚举值（含存量数据），否则 ADD CONSTRAINT 会触发 check_violation。
 */

export async function up(db: Kysely<unknown>): Promise<void> {
  // ─── 1. task_batches 加字段（开放接口回调 / 对外 task_id） ─────────────────
  await db.schema
    .alterTable('task_batches')
    .addColumn('business_id', 'varchar(50)')
    .execute()

  await db.schema
    .alterTable('task_batches')
    .addColumn('callback_url', 'text')
    .execute()

  await db.schema
    .alterTable('task_batches')
    .addColumn('callback_attempts', 'integer', (col) => col.notNull().defaultTo(0))
    .execute()

  // pending | succeeded | failed（回调状态）
  await db.schema
    .alterTable('task_batches')
    .addColumn('callback_status', 'varchar(20)')
    .execute()

  // image | song | video | news | podcast | storybook | text（服务类型）
  await db.schema
    .alterTable('task_batches')
    .addColumn('service_type', 'varchar(30)')
    .execute()

  // 对外 task_id（源项目契约字段，区别于内部 batch id）
  await db.schema
    .alterTable('task_batches')
    .addColumn('task_id', 'varchar(50)')
    .execute()

  await db.schema
    .alterTable('task_batches')
    .addColumn('finished_at', 'timestamptz')
    .execute()

  // 回调状态索引：支持回调调度按状态扫描待重试任务
  await db.schema
    .createIndex('idx_task_batches_callback')
    .on('task_batches')
    .columns(['callback_status'])
    .execute()

  // ─── 2. tasks 加外部任务轮询载荷 ──────────────────────────────────────────
  await db.schema
    .alterTable('tasks')
    .addColumn('external_status', 'varchar(30)')
    .execute()

  await db.schema
    .alterTable('tasks')
    .addColumn('last_polled_at', 'timestamptz')
    .execute()

  // ─── 3. 扩展 task_batches.source 约束：新增 open_api ──────────────────────
  await sql`ALTER TABLE task_batches DROP CONSTRAINT IF EXISTS chk_tb_source`.execute(db)
  await sql`ALTER TABLE task_batches ADD CONSTRAINT chk_tb_source CHECK (source IN ('generation','studio','canvas','open_api'))`.execute(db)

  // ─── 4. 扩展 task_batches.module 约束：新增 podcast / news / storybook ────
  // 须覆盖 064 已有的全部值（含 text），否则存量数据触发 check_violation
  await sql`ALTER TABLE task_batches DROP CONSTRAINT IF EXISTS chk_tb_module`.execute(db)
  await sql`ALTER TABLE task_batches ADD CONSTRAINT chk_tb_module CHECK (module IN ('image','video','tts','lipsync','agent','avatar','action_imitation','storyboard','upload','music','music_voice_clone','picture_book','short_drama','text','podcast','news','storybook'))`.execute(db)

  // ─── 5. api_clients 表（新建） ────────────────────────────────────────────
  await db.schema
    .createTable('api_clients')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('name', 'varchar(100)', (col) => col.notNull().unique())
    // sha256(api_key) 摘要，明文 key 仅在创建时返回一次
    .addColumn('api_key_hash', 'varchar(255)', (col) => col.notNull().unique())
    .addColumn('status', 'varchar(20)', (col) => col.notNull().defaultTo('active'))
    // 归属团队（方案 B'：开放接口流量归属真实租户，而非平台级幽灵）
    .addColumn('team_id', 'uuid')
    // 默认工作区
    .addColumn('workspace_id', 'uuid')
    // 归属系统用户（写入 task_batches.user_id）
    .addColumn('system_user_id', 'uuid')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  // 1. 删除 api_clients 表
  await db.schema.dropTable('api_clients').ifExists().execute()

  // 2. 恢复 module 约束为迁移前（剔除 podcast/news/storybook，保留 064 的 text）
  await sql`ALTER TABLE task_batches DROP CONSTRAINT IF EXISTS chk_tb_module`.execute(db)
  await sql`ALTER TABLE task_batches ADD CONSTRAINT chk_tb_module CHECK (module IN ('image','video','tts','lipsync','agent','avatar','action_imitation','storyboard','upload','music','music_voice_clone','picture_book','short_drama','text'))`.execute(db)

  // 3. 恢复 source 约束为迁移前（剔除 open_api）
  await sql`ALTER TABLE task_batches DROP CONSTRAINT IF EXISTS chk_tb_source`.execute(db)
  await sql`ALTER TABLE task_batches ADD CONSTRAINT chk_tb_source CHECK (source IN ('generation','studio','canvas'))`.execute(db)

  // 4. 删除 tasks 新增列
  await db.schema
    .alterTable('tasks')
    .dropColumn('last_polled_at')
    .dropColumn('external_status')
    .execute()

  // 5. 删除回调索引
  await db.schema.dropIndex('idx_task_batches_callback').execute()

  // 6. 删除 task_batches 新增列
  await db.schema
    .alterTable('task_batches')
    .dropColumn('finished_at')
    .dropColumn('task_id')
    .dropColumn('service_type')
    .dropColumn('callback_status')
    .dropColumn('callback_attempts')
    .dropColumn('callback_url')
    .dropColumn('business_id')
    .execute()
}
