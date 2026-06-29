import type { Kysely } from 'kysely'
import { sql } from 'kysely'

/**
 * 079_biz_mgmt_member_bindings_master.ts
 *
 * 业管 MEMBER-1001 响应新增 master 字段（0=副卡，1=主卡），代表会员在公司组织内的
 * 团队管理权。本迁移在 biz_mgmt_member_bindings 增加 is_master 列作为本地快照。
 *
 * 语义约定：
 * - 主卡（is_master=true）：拥有对应团队的团队管理权，本地 team_members.role 镜像为 owner，
 *   可触发 MEMBER-1002 创建副卡成员。
 * - 副卡（is_master=false）：普通成员，本地 team_members.role 镜像为 editor，无团队管理权。
 *
 * 业管 master 是团队管理权的权威来源，本地 role 是其单向镜像（由 member-sync 对齐），
 * 不允许在前端/其他路由反向改写 is_master。本列只存身份快照，不存余额/权益（沿用本表既有约束）。
 *
 * DEFAULT false：历史 binding 数据未携带 master，保守按副卡（无管理权）处理，
 * 待下次登录业管返回真实 master 时由 member-sync 刷新对齐。
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('biz_mgmt_member_bindings')
    .addColumn('is_master', 'boolean', (col) => col.notNull().defaultTo(false))
    .execute()

  await sql`COMMENT ON COLUMN biz_mgmt_member_bindings.is_master IS '业管会员主卡标记，来源 MEMBER-1001 members[].master（1=主卡，0=副卡）。主卡拥有团队管理权（本地 team_members.role 镜像为 owner），副卡为普通成员（editor）。业管 master 是团队管理权的权威来源，本地 role 是其单向镜像，由 member-sync 在登录时对齐，不允许反向改写。'`.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('biz_mgmt_member_bindings').dropColumn('is_master').execute()
}
