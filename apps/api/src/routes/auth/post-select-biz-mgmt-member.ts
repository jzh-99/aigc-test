import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'
import { sql } from 'kysely'
import { buildUserProfile } from '../../services/user-profile.js'

/**
 * POST /auth/select-biz-mgmt-member — 选择当前业管会员身份。
 *
 * 设计决策（见 docs/superpowers/plans/2026-06-25-biz-mgmt-member-account-selection.md）：
 * - 仅更新 biz_mgmt_member_bindings.is_selected 标记，不重签 access token。
 *   重签 token 会绕过现有单会话语义（session_version / refresh token 撤销），
 *   身份选择不属于会话切换，故只改绑定状态并返回最新 profile，前端用原 token 继续。
 * - 仅允许选择 status=1（正常）的业管身份；非本人绑定或已冻结身份返回 404。
 * - 同一 local_user_id 最多一条 is_selected=true：事务内先清空再置位。
 */
const route: FastifyPluginAsync = async (app) => {
  app.post<{ Body: { biz_mgmt_user_id: string } }>(
    '/auth/select-biz-mgmt-member',
    {
      schema: {
        body: {
          type: 'object',
          required: ['biz_mgmt_user_id'],
          properties: {
            biz_mgmt_user_id: { type: 'string', minLength: 1, maxLength: 64 },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const db = getDb()
      // 仅允许选择本人且 status=1 的业管身份
      const binding = await db
        .selectFrom('biz_mgmt_member_bindings')
        .select(['id'])
        .where('local_user_id', '=', request.user.id)
        .where('biz_mgmt_user_id', '=', request.body.biz_mgmt_user_id)
        .where('status', '=', 1)
        .executeTakeFirst()

      if (!binding) {
        return reply.status(404).send({
          success: false,
          error: { code: 'BIZ_MGMT_MEMBER_NOT_FOUND', message: '账号身份不存在或不可用' },
        })
      }

      // 事务内先清空同用户其它选中标记，再置位当前身份，保证唯一选中
      await db.transaction().execute(async (trx) => {
        await trx
          .updateTable('biz_mgmt_member_bindings')
          .set({ is_selected: false, updated_at: sql`now()` })
          .where('local_user_id', '=', request.user.id)
          .execute()
        await trx
          .updateTable('biz_mgmt_member_bindings')
          .set({ is_selected: true, updated_at: sql`now()` })
          .where('id', '=', binding.id)
          .execute()
      })

      // 返回最新 profile（含新的 current_biz_mgmt_user_id），不重签 token
      const profile = await buildUserProfile(db, request.user.id)
      return { user: profile }
    },
  )
}

export default route
