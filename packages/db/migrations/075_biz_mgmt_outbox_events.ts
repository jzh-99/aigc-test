import type { Kysely } from 'kysely'
import { sql } from 'kysely'

/**
 * 075_biz_mgmt_outbox_events.ts
 *
 * 业务管理平台出站通知 outbox 表。
 *
 * 权威约束（见 docs/superpowers/plans/2026-06-25-biz-mgmt-member-account-selection.md）：
 * - 所有本地状态变化后需要通知业管的事件先入本表，再由 biz-mgmt-notify-queue 异步投递。
 * - 业务事务内只写 pending；事务提交后投递队列。失败按指数退避重试，达上限置 failed。
 * - 成功和失败记录都必须保留，不删除。
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('biz_mgmt_outbox_events')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('event_type', 'varchar(64)', (col) => col.notNull())
    .addColumn('dedupe_key', 'varchar(180)', (col) => col.notNull())
    .addColumn('status', 'varchar(32)', (col) => col.notNull().defaultTo('pending'))
    .addColumn('local_user_id', 'uuid')
    .addColumn('biz_mgmt_user_id', 'varchar(64)')
    .addColumn('phone', 'varchar(20)')
    .addColumn('team_id', 'uuid')
    .addColumn('workspace_id', 'uuid')
    .addColumn('task_id', 'uuid')
    .addColumn('batch_id', 'uuid')
    .addColumn('task_status', 'varchar(32)')
    .addColumn('points_num', 'numeric(12, 2)')
    .addColumn('payload', 'jsonb', (col) => col.notNull())
    .addColumn('last_response', 'jsonb')
    .addColumn('last_error', 'text')
    .addColumn('attempt_count', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('max_attempts', 'integer', (col) => col.notNull().defaultTo(8))
    .addColumn('next_attempt_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('locked_at', 'timestamptz')
    .addColumn('locked_by', 'varchar(128)')
    .addColumn('sent_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('uq_biz_mgmt_outbox_events_dedupe_key', ['dedupe_key'])
    .execute()

  await sql`ALTER TABLE biz_mgmt_outbox_events ADD CONSTRAINT chk_biz_mgmt_outbox_event_type CHECK (event_type IN ('creation_result_notify','member_sub_card_sync'))`.execute(db)
  await sql`ALTER TABLE biz_mgmt_outbox_events ADD CONSTRAINT chk_biz_mgmt_outbox_status CHECK (status IN ('pending','processing','succeeded','failed'))`.execute(db)
  await db.schema.createIndex('idx_biz_mgmt_outbox_pending').on('biz_mgmt_outbox_events').columns(['status', 'next_attempt_at']).execute()
  await db.schema.createIndex('idx_biz_mgmt_outbox_user').on('biz_mgmt_outbox_events').column('biz_mgmt_user_id').execute()
  await db.schema.createIndex('idx_biz_mgmt_outbox_task').on('biz_mgmt_outbox_events').columns(['batch_id', 'task_id']).execute()

  await sql`COMMENT ON TABLE biz_mgmt_outbox_events IS '业务管理平台出站通知 outbox 表。所有本地状态变化后需要通知业管的事件先入本表，再由 biz-mgmt-notify-queue 异步投递；多次失败后保留 failed 记录用于人工排查和补偿。'`.execute(db)
  await sql`COMMENT ON COLUMN biz_mgmt_outbox_events.event_type IS '出站事件类型。creation_result_notify=创作结果同步到 AIHUB_CREATION_RESULT_NOTIFY；member_sub_card_sync=团队成员创建后同步会员副卡到 MEMBER-1002。'`.execute(db)
  await sql`COMMENT ON COLUMN biz_mgmt_outbox_events.dedupe_key IS '幂等键，全局唯一。创作结果建议 creation-result:{requestNo}；会员副卡建议 member-sub-card:{teamId}:{userId}:{phone}。重复入队必须复用同一 dedupe_key。'`.execute(db)
  await sql`COMMENT ON COLUMN biz_mgmt_outbox_events.status IS '投递状态，pending=待投递或等待下次重试，processing=队列 worker 已领取并正在调用业管，succeeded=业管返回成功且已记录 last_response/sent_at，failed=超过 max_attempts 或不可重试错误。成功和失败记录都必须保留。'`.execute(db)
  await sql`COMMENT ON COLUMN biz_mgmt_outbox_events.local_user_id IS '本地用户 ID，记录事件相关用户。创作结果为发起生成用户；会员副卡为被创建的团队成员用户。'`.execute(db)
  await sql`COMMENT ON COLUMN biz_mgmt_outbox_events.biz_mgmt_user_id IS '业管会员 ID。创作结果为当前扣费会员；会员副卡为团长或所属主会员 ID，具体映射来自 biz_mgmt_member_bindings。'`.execute(db)
  await sql`COMMENT ON COLUMN biz_mgmt_outbox_events.phone IS '事件相关手机号。会员副卡同步时为新成员手机号；创作结果可为空。'`.execute(db)
  await sql`COMMENT ON COLUMN biz_mgmt_outbox_events.team_id IS '本地团队 ID，用于定位团队、团长和成员创建上下文。'`.execute(db)
  await sql`COMMENT ON COLUMN biz_mgmt_outbox_events.workspace_id IS '本地工作空间 ID，用于定位创作所在空间；会员副卡同步可为空。'`.execute(db)
  await sql`COMMENT ON COLUMN biz_mgmt_outbox_events.task_id IS '本地任务 ID，创作结果同步时填写 tasks.id；会员副卡同步为空。'`.execute(db)
  await sql`COMMENT ON COLUMN biz_mgmt_outbox_events.batch_id IS '本地批次 ID，创作结果同步时填写 task_batches.id；会员副卡同步为空。'`.execute(db)
  await sql`COMMENT ON COLUMN biz_mgmt_outbox_events.task_status IS '任务终态。创作结果同步取 completed 或 failed；会员副卡同步为空。'`.execute(db)
  await sql`COMMENT ON COLUMN biz_mgmt_outbox_events.points_num IS '事件相关 A 豆数量，单位 A 豆。创作结果同步为本次扣减或实际消耗；会员副卡同步为 initialPointsNum。该字段不是余额。'`.execute(db)
  await sql`COMMENT ON COLUMN biz_mgmt_outbox_events.payload IS '出站请求 JSON。creation_result_notify 结构：userId=业管会员 ID，requestNo=扣减幂等号，workNo=作品号，success=是否成功，remark=500 字内结果说明；member_sub_card_sync 结构：phone=新成员手机号，userName=新成员名称，compName=团队/公司名称，channel=来源渠道，belongId=所属主会员 ID，initialPointsNum=副卡初始 A 豆。'`.execute(db)
  await sql`COMMENT ON COLUMN biz_mgmt_outbox_events.last_response IS '最近一次业管响应 JSON。结构：code=返回码，message=返回信息，decryptedData=验签解密后的响应体；成功和失败响应都要记录，便于审计和排障；为空表示尚未收到响应。'`.execute(db)
  await sql`COMMENT ON COLUMN biz_mgmt_outbox_events.last_error IS '最近一次投递失败错误摘要，包括网络错误、验签失败、业管业务失败等；成功后清空。'`.execute(db)
  await sql`COMMENT ON COLUMN biz_mgmt_outbox_events.attempt_count IS '已经尝试投递次数，首次消费前为 0，每次实际调用业管接口前加 1。'`.execute(db)
  await sql`COMMENT ON COLUMN biz_mgmt_outbox_events.max_attempts IS '最大投递次数，默认 8。达到后状态置 failed，不再自动重试。'`.execute(db)
  await sql`COMMENT ON COLUMN biz_mgmt_outbox_events.next_attempt_at IS '下一次允许投递时间。失败后按指数退避更新，例如 1m、5m、15m、1h、6h。'`.execute(db)
  await sql`COMMENT ON COLUMN biz_mgmt_outbox_events.locked_at IS '队列 worker 领取事件的时间，用于识别卡死 processing 事件。'`.execute(db)
  await sql`COMMENT ON COLUMN biz_mgmt_outbox_events.locked_by IS '领取事件的 worker 标识，用于排查并发消费。'`.execute(db)
  await sql`COMMENT ON COLUMN biz_mgmt_outbox_events.sent_at IS '业管通知成功时间。仅当 status=succeeded 时写入；成功记录保留在 outbox 表中，不删除。'`.execute(db)
  await sql`COMMENT ON COLUMN biz_mgmt_outbox_events.created_at IS 'outbox 事件创建时间，必须与本地业务状态变化处于同一事务或同一失败可恢复流程。'`.execute(db)
  await sql`COMMENT ON COLUMN biz_mgmt_outbox_events.updated_at IS 'outbox 事件最近更新时间。'`.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('biz_mgmt_outbox_events').execute()
}
