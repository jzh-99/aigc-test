import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'
import { fetchBizMgmtMembersByPhone, purgeLocalUserCascade } from '../../services/biz-mgmt-member-sync.js'

/**
 * POST /auth/check-biz-mgmt — 业管先行登录第一步：查业管账号是否存在。
 *
 * 这是两步式登录"下一步"按钮的后端实现（见 2026-06-26 业管先行改造）：
 * 用户输入完整手机号点"下一步"时调用本接口，从业管 MEMBER-1001 查询该手机号
 * 是否存在会员。业管是账号唯一判官（Critical Login Invariant），结果直接决定
 * 前端是否进入密码输入步。
 *
 * 返回约定（前端据此切换视图）：
 * - 200 { exists: true }：业管有 ≥1 个 status=1 会员，前端进入密码步。
 * - 401 { error.code: 'BIZ_MGMT_NOT_FOUND' }：业管查无会员或接口故障（故障等同查无）。
 *   若本地存在该手机号孤儿 user，先物理清理其全部业务数据，再返回此码。
 *
 * 安全说明：本接口只返回布尔 exists，不返回会员明细，避免向未认证请求泄露
 * 账号信息（会员明细在 /auth/login 成功后随 profile 返回）。
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

    // 业管有会员：前端进入密码步
    return { exists: true }
  })
}

export default route
