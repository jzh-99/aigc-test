import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'
import { ensureLocalUserForBizMgmtPhone, syncBizMgmtMembersForLocalUser, fetchBizMgmtMembersByPhone, purgeLocalUserCascade } from '../../services/biz-mgmt-member-sync.js'

/**
 * POST /auth/check-biz-mgmt — 业管先行登录第一步：查业管账号是否存在。
 *
 * 这是两步式登录"下一步"按钮的后端实现（见 2026-06-26 业管先行改造）：
 * 用户输入完整手机号点"下一步"时调用本接口，从业管 MEMBER-1001 查询该手机号
 * 是否存在会员。业管是账号唯一判官（Critical Login Invariant），结果直接决定
 * 前端是否进入密码输入步。
 *
 * 返回约定（前端据此切换视图）：
 * - 200 { exists: true }：业管有 ≥1 个 status=1 会员，且本地已存在该手机号 user（老用户）。前端进入密码步。
 * - 200 { exists: true, one_time_password: string }：业管有会员但本地无 user（新用户）。
 *   本接口此时【预建本地 user + 生成一次性初始密码 + 同步为每个业管账号建 team/workspace/binding】
 *   并随响应返回初始密码，前端进密码步后展示该密码供用户登录。
 * - 200 { exists: true }：业管有会员且本地已有 user（老用户）。本接口同步刷新业管绑定、补建缺失 team。
 * - 401 { error.code: 'BIZ_MGMT_NOT_FOUND' }：业管查无会员或接口故障（故障等同查无）。
 *   若本地存在该手机号孤儿 user，先物理清理其全部业务数据，再返回此码。
 *
 * 安全说明：仅返回布尔 exists 和（新用户）一次性初始密码，不返回会员明细，避免向未认证请求泄露
 * 账号信息（会员明细在 /auth/login 成功后随 profile 返回）。
 * 初始密码经 HTTPS 传输、用完即改（password_change_required=true），遗失联系管理员重置。
 * 频率限制复用全局 1200/min，登录接口另有 10/min 的更严限制。
 */
const route: FastifyPluginAsync = async (app) => {
  app.post<{ Body: { phone: string } }>('/auth/check-biz-mgmt', {
    schema: {
      body: {
        type: 'object',
        required: ['phone'],
        properties: {
          phone: { type: 'string', minLength: 11, maxLength: 11 },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const { phone } = request.body

    // 手机号格式校验：11 位、首位为 1（与 post-login 的 PHONE_RE 一致）
    if (!/^1\d{10}$/.test(phone)) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_PHONE', message: '手机号格式不正确' },
      })
    }

    // 【无条件先查业管】try/catch：故障等同查无
    let members: Awaited<ReturnType<typeof fetchBizMgmtMembersByPhone>>
    try {
      members = await fetchBizMgmtMembersByPhone(phone)
    } catch (err) {
      // 业管接口故障：按用户要求"一律拒绝+清理"，等同查无。
      // 用 request.log.error 记录，生产环境进 api-err.log（PM2）或 docker logs（容器），
      // 结构化 JSON 带 phone 便于排查；不阻塞请求。
      request.log.error({ err, phone }, '业管会员查询失败（check-biz-mgmt），按查无处理')
      members = []
    }

    if (members.length === 0) {
      // 业管查无（或故障）：若本地存在该手机号孤儿 user，物理清理后拒绝
      const db = getDb()
      const existingUser = await db
        .selectFrom('users')
        .select(['id'])
        .where('phone', '=', phone)
        .executeTakeFirst()
      if (existingUser) {
        await purgeLocalUserCascade(existingUser.id)
      }
      return reply.status(401).send({
        success: false,
        error: { code: 'BIZ_MGMT_NOT_FOUND', message: '用户不存在' },
      })
    }

    // 业管有会员：预建本地 user（本地无则建 + 生成一次性初始密码），并【同步】为每个
    // 业管账号建好 team/workspace/binding，再让前端进入密码步。
    // 建 user 与建 team 责任都在 check 阶段同步完成，消除"已登录但 team 未建好"的窗口期；
    // login 阶段只校验密码。syncBizMgmtMembersForLocalUser 幂等，老用户重复登录不会重建已存在的 team。
    const db = getDb()
    const existingUser = await db
      .selectFrom('users')
      .select(['id'])
      .where('phone', '=', phone)
      .executeTakeFirst()
    const localUserId = existingUser?.id
    if (!localUserId) {
      // 新用户：业管有会员但本地无 user → 预建 user + 生成一次性初始密码
      const created = await ensureLocalUserForBizMgmtPhone(phone)
      // ensureLocalUserForBizMgmtPhone 内部已确认业管有 status=1 会员；oneTimePassword 仅新建时非空
      // 同步为每个业管账号建 team/workspace/binding
      await syncBizMgmtMembersForLocalUser(created.userId, phone)
      return { exists: true, one_time_password: created.oneTimePassword }
    }
    // 老用户：同步刷新业管绑定，补建缺失的 team/workspace（幂等，已有不重建）
    await syncBizMgmtMembersForLocalUser(localUserId, phone)
    return { exists: true }
  })
}

export default route
