import type { Kysely } from 'kysely'
import { sql } from 'kysely'

/**
 * 073_biz_mgmt_member_bindings.ts
 *
 * 业务管理平台会员身份绑定缓存表。
 *
 * 设计约束（见 docs/superpowers/plans/2026-06-25-biz-mgmt-member-account-selection.md）：
 * - 业管平台是会员、权益、A 豆余额的权威来源，本表只做身份选择与本地资源归属映射。
 * - 本表不得保存 A 豆余额、累计获得、累计消费；这些字段必须实时从业管查询。
 * - 同一手机号可对应多个业管会员身份（个人 + 多个公司），全部绑定到同一本地登录用户。
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('biz_mgmt_member_bindings')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('local_user_id', 'uuid', (col) => col.notNull().references('users.id').onDelete('cascade'))
    .addColumn('biz_mgmt_user_id', 'varchar(64)', (col) => col.notNull())
    .addColumn('phone', 'varchar(20)', (col) => col.notNull())
    .addColumn('user_name', 'varchar(255)', (col) => col.notNull())
    .addColumn('user_type', 'varchar(10)', (col) => col.notNull())
    .addColumn('status', 'integer', (col) => col.notNull())
    .addColumn('comp_name', 'varchar(255)', (col) => col.notNull())
    .addColumn('goods_id', 'varchar(64)')
    .addColumn('goods_name', 'varchar(255)')
    .addColumn('biz_mgmt_created_at', 'timestamptz')
    .addColumn('team_id', 'uuid', (col) => col.notNull().references('teams.id'))
    .addColumn('workspace_id', 'uuid', (col) => col.notNull().references('workspaces.id'))
    .addColumn('is_selected', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('last_synced_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('uq_biz_mgmt_member_bindings_biz_mgmt_user_id', ['biz_mgmt_user_id'])
    .addUniqueConstraint('uq_biz_mgmt_member_bindings_user_team', ['local_user_id', 'team_id'])
    .execute()

  await sql`ALTER TABLE biz_mgmt_member_bindings ADD CONSTRAINT chk_biz_mgmt_member_user_type CHECK (user_type IN ('1','2'))`.execute(db)
  await sql`ALTER TABLE biz_mgmt_member_bindings ADD CONSTRAINT chk_biz_mgmt_member_status CHECK (status IN (1,2,3))`.execute(db)
  await db.schema.createIndex('idx_biz_mgmt_member_bindings_phone').on('biz_mgmt_member_bindings').column('phone').execute()
  await db.schema.createIndex('idx_biz_mgmt_member_bindings_local_user').on('biz_mgmt_member_bindings').column('local_user_id').execute()

  await sql`COMMENT ON TABLE biz_mgmt_member_bindings IS '业务管理平台会员身份绑定缓存表。每条记录表示一个业管会员身份与一个本地登录用户、本地团队、默认工作空间之间的映射；业管平台是会员、权益和 A 豆余额的权威来源，本表只做登录后身份选择、权益商品展示和本地资源归属映射，不保存 A 豆余额、累计获得或累计消费。'`.execute(db)
  await sql`COMMENT ON COLUMN biz_mgmt_member_bindings.id IS '本地绑定记录主键，UUID，由 PostgreSQL 自动生成；不暴露给业管平台。'`.execute(db)
  await sql`COMMENT ON COLUMN biz_mgmt_member_bindings.local_user_id IS '本地登录用户 ID，关联 users.id。一个本地手机号登录主体可以绑定多个业管会员身份。'`.execute(db)
  await sql`COMMENT ON COLUMN biz_mgmt_member_bindings.biz_mgmt_user_id IS '业务管理平台会员编号，来源于 MEMBER-1001 响应 members[].userId；全局唯一，是后续 A 豆扣减、流水查询、创作结果同步的会员主键。'`.execute(db)
  await sql`COMMENT ON COLUMN biz_mgmt_member_bindings.phone IS '会员手机号，来源于 MEMBER-1001 响应 members[].phone；用于每次本地手机号登录成功后刷新业管会员列表。'`.execute(db)
  await sql`COMMENT ON COLUMN biz_mgmt_member_bindings.user_name IS '业管会员名称，来源于 members[].userName；用于账号身份选择页展示，不作为权限判断依据。'`.execute(db)
  await sql`COMMENT ON COLUMN biz_mgmt_member_bindings.user_type IS '业管会员类型，来源于 members[].userType；取值 1=个人会员，2=公司会员。个人会员映射本地 personal 团队，公司会员映射本地 company_a 团队。'`.execute(db)
  await sql`COMMENT ON COLUMN biz_mgmt_member_bindings.status IS '业管会员状态，来源于 members[].status；取值 1=正常，2=冻结，3=删除。只有 status=1 的记录可被选择为当前身份。'`.execute(db)
  await sql`COMMENT ON COLUMN biz_mgmt_member_bindings.comp_name IS '公司名称或个人标识，来源于 members[].compName；个人会员通常为“个人”，公司会员为公司名称，用作团队名称优先来源。'`.execute(db)
  await sql`COMMENT ON COLUMN biz_mgmt_member_bindings.goods_id IS '最近一条已完成订购记录的商品 ID，来源于 members[].goodsId；用于展示当前权益，不作为本地计费权威。'`.execute(db)
  await sql`COMMENT ON COLUMN biz_mgmt_member_bindings.goods_name IS '最近一条已完成订购记录的商品名称，来源于 members[].goodsName；用于展示当前权益，不作为本地计费权威。'`.execute(db)
  await sql`COMMENT ON COLUMN biz_mgmt_member_bindings.biz_mgmt_created_at IS '业管会员注册时间，来源于 members[].createTime，格式 yyyy-MM-dd HH:mm:ss，入库为 timestamptz；为空表示业管未返回。'`.execute(db)
  await sql`COMMENT ON COLUMN biz_mgmt_member_bindings.team_id IS '该业管会员身份对应的本地团队 ID。个人会员创建个人团队，公司会员创建公司团队；用于本地资源、工作区和任务归属。'`.execute(db)
  await sql`COMMENT ON COLUMN biz_mgmt_member_bindings.workspace_id IS '该业管会员身份对应的默认本地工作空间 ID。用户选择身份后默认进入此工作空间。'`.execute(db)
  await sql`COMMENT ON COLUMN biz_mgmt_member_bindings.is_selected IS '当前本地用户最近选择的业管会员身份标记。同一 local_user_id 理论上最多一条为 true；选择身份接口会先清空再设置。'`.execute(db)
  await sql`COMMENT ON COLUMN biz_mgmt_member_bindings.last_synced_at IS '最近一次从业管 MEMBER-1001 成功刷新该身份快照的时间；用于判断缓存新鲜度和排查同步问题。'`.execute(db)
  await sql`COMMENT ON COLUMN biz_mgmt_member_bindings.created_at IS '本地绑定记录创建时间。'`.execute(db)
  await sql`COMMENT ON COLUMN biz_mgmt_member_bindings.updated_at IS '本地绑定记录最近更新时间，包括快照刷新、状态变化和身份选择相关更新。'`.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('biz_mgmt_member_bindings').execute()
}
