import type { FastifyPluginAsync } from 'fastify'
import {
  syncTobyMemberSubCard,
  type TobyMemberSubCardRequest,
} from '../../../lib/toby-open-api.js'
import { sendTobyResult } from './_shared.js'

const route: FastifyPluginAsync = async (app) => {
  // POST /external/toby/member/sub-card — 调用 Toby 会员副卡变动同步接口。
  // 2026-06-29 契约更新：移除 compName / channel，仅保留 phone/userName/belongId/initialPointsNum。
  app.post<{ Body: TobyMemberSubCardRequest }>(
    '/external/toby/member/sub-card',
    {
      schema: {
        body: {
          type: 'object',
          required: ['phone', 'userName', 'belongId', 'initialPointsNum'],
          properties: {
            phone: { type: 'string' },
            userName: { type: 'string' },
            belongId: { type: 'string' },
            initialPointsNum: { anyOf: [{ type: 'number' }, { type: 'string' }] },
          },
        },
      },
    },
    async (request, reply) => sendTobyResult(reply, () => syncTobyMemberSubCard(request.body)),
  )
}

export default route
