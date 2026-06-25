import type { Kysely } from 'kysely'
import { sql } from 'kysely'

/**
 * 074_biz_mgmt_a_bean_transactions.ts
 *
 * 业务管理平台 A 豆扣减审计表。
 *
 * 权威约束（见 docs/superpowers/plans/2026-06-25-biz-mgmt-member-account-selection.md）：
 * - 本表只记录本地生成任务调用业管扣减的幂等请求号、状态、请求响应。
 * - 不保存用户 A 豆余额、累计获得、累计消费等动态权益数据。
 * - 创作结果同步投递状态由 biz_mgmt_outbox_events 承接，不在本表落字段。
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('biz_mgmt_a_bean_transactions')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('local_user_id', 'uuid', (col) => col.notNull().references('users.id').onDelete('cascade'))
    .addColumn('team_id', 'uuid', (col) => col.notNull().references('teams.id'))
    .addColumn('workspace_id', 'uuid', (col) => col.references('workspaces.id'))
    .addColumn('biz_mgmt_user_id', 'varchar(64)', (col) => col.notNull())
    .addColumn('request_no', 'varchar(128)', (col) => col.notNull())
    .addColumn('work_no', 'varchar(128)', (col) => col.notNull())
    .addColumn('source', 'integer', (col) => col.notNull())
    .addColumn('points_num', 'numeric(12, 2)', (col) => col.notNull())
    .addColumn('remark', 'varchar(500)')
    .addColumn('task_id', 'uuid')
    .addColumn('batch_id', 'uuid')
    .addColumn('deduct_status', 'varchar(32)', (col) => col.notNull().defaultTo('pending'))
    .addColumn('deduct_response', 'jsonb')
    .addColumn('last_error', 'text')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('uq_biz_mgmt_a_bean_transactions_request_no', ['request_no'])
    .execute()

  await sql`ALTER TABLE biz_mgmt_a_bean_transactions ADD CONSTRAINT chk_biz_mgmt_a_bean_deduct_status CHECK (deduct_status IN ('pending','succeeded','failed'))`.execute(db)
  await db.schema.createIndex('idx_biz_mgmt_a_bean_transactions_user').on('biz_mgmt_a_bean_transactions').column('biz_mgmt_user_id').execute()
  await db.schema.createIndex('idx_biz_mgmt_a_bean_transactions_batch').on('biz_mgmt_a_bean_transactions').column('batch_id').execute()

  await sql`COMMENT ON TABLE biz_mgmt_a_bean_transactions IS '业务管理平台 A 豆扣减与创作结果同步审计表。记录本地生成任务调用业管扣减和结果同步的幂等请求号、状态、请求响应，不保存用户 A 豆余额、累计获得、累计消费等动态权益数据。'`.execute(db)
  await sql`COMMENT ON COLUMN biz_mgmt_a_bean_transactions.local_user_id IS '本地登录用户 ID，关联 users.id；用于审计是谁发起生成，不作为业管会员主键。'`.execute(db)
  await sql`COMMENT ON COLUMN biz_mgmt_a_bean_transactions.team_id IS '本地团队 ID，关联 teams.id；来源于用户当前选择的业管会员身份映射，用于本地资源归属。'`.execute(db)
  await sql`COMMENT ON COLUMN biz_mgmt_a_bean_transactions.workspace_id IS '本地工作空间 ID，关联 workspaces.id；允许为空表示任务未绑定具体工作空间。'`.execute(db)
  await sql`COMMENT ON COLUMN biz_mgmt_a_bean_transactions.biz_mgmt_user_id IS '业管会员编号，来源于 biz_mgmt_member_bindings.biz_mgmt_user_id；A 豆扣减、流水查询、创作结果同步均以该字段作为会员身份。'`.execute(db)
  await sql`COMMENT ON COLUMN biz_mgmt_a_bean_transactions.request_no IS '调用业管 A 豆扣减接口的幂等请求号；建议使用 bizmgmt-{batchId}-{taskId 或 submit}，全局唯一，重复请求必须复用同一值。'`.execute(db)
  await sql`COMMENT ON COLUMN biz_mgmt_a_bean_transactions.work_no IS '业管作品编号，对应 A 豆扣减和创作结果同步接口 workNo；优先使用 task_id，批量任务可使用 batch_id 加序号。'`.execute(db)
  await sql`COMMENT ON COLUMN biz_mgmt_a_bean_transactions.source IS '业管 A 豆扣减来源，取值按业管接口文档定义；本地不重新定义枚举含义，必须在调用服务中集中映射。'`.execute(db)
  await sql`COMMENT ON COLUMN biz_mgmt_a_bean_transactions.points_num IS '本次生成预估扣减 A 豆数量，单位 A 豆，numeric(12,2)；用于请求业管扣减接口和审计，不表示账户余额。'`.execute(db)
  await sql`COMMENT ON COLUMN biz_mgmt_a_bean_transactions.remark IS '扣减备注，最多 500 字；包含模块、模型、任务摘要等便于业管侧排查的信息。'`.execute(db)
  await sql`COMMENT ON COLUMN biz_mgmt_a_bean_transactions.task_id IS '本地 tasks.id；允许为空表示扣减发生在创建任务前或批量级扣减。'`.execute(db)
  await sql`COMMENT ON COLUMN biz_mgmt_a_bean_transactions.batch_id IS '本地 task_batches.id；用于关联批次终态并触发创作结果同步。'`.execute(db)
  await sql`COMMENT ON COLUMN biz_mgmt_a_bean_transactions.deduct_status IS '业管扣减调用状态，pending=本地已创建审计但未成功扣减，succeeded=业管扣减成功，failed=业管扣减失败且不得创建付费生成任务。'`.execute(db)
  await sql`COMMENT ON COLUMN biz_mgmt_a_bean_transactions.deduct_response IS '业管扣减接口响应 JSON。结构说明：code=业管返回码，message=业管返回信息，decryptedData=验签解密后的响应体；仅用于审计和排障，不包含本地计算余额。'`.execute(db)
  await sql`COMMENT ON COLUMN biz_mgmt_a_bean_transactions.last_error IS '最近一次 A 豆扣减失败的错误摘要；用于排障，不展示给普通用户。创作结果同步失败记录保存在 biz_mgmt_outbox_events。'`.execute(db)
  await sql`COMMENT ON COLUMN biz_mgmt_a_bean_transactions.created_at IS '本地审计记录创建时间。'`.execute(db)
  await sql`COMMENT ON COLUMN biz_mgmt_a_bean_transactions.updated_at IS '本地扣减审计记录最近更新时间，包括扣减状态和错误信息变化。'`.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('biz_mgmt_a_bean_transactions').execute()
}
