import type { FastifyPluginAsync } from 'fastify'
import {
  changeTobyMemberPoints,
  type TobyMemberPointsChangeRequest,
} from '../../../lib/toby-open-api.js'
import { sendTobyResult } from './_shared.js'

const route: FastifyPluginAsync = async (app) => {
  // POST /external/toby/member/points-change — 调用 Toby 会员副卡 A豆变动接口（MEMBER-1005）。
  // 薄代理：透传业管请求/响应契约，供契约联调；业务侧入口在 /teams/:id/members/:uid/points-change。
  app.post<{ Body: TobyMemberPointsChangeRequest }>(
    '/external/toby/member/points-change',
    {
      schema: {
        body: {
          type: 'object',
          required: ['mainUserId', 'subUserId', 'changeType', 'pointsNum'],
          properties: {
            mainUserId: { type: 'string' },
            subUserId: { type: 'string' },
            changeType: { type: 'integer', enum: [1, 2] },
            pointsNum: { anyOf: [{ type: 'number' }, { type: 'string' }] },
          },
        },
      },
    },
    async (request, reply) => sendTobyResult(reply, () => changeTobyMemberPoints(request.body)),
  )
}

export default route
