import type { FastifyPluginAsync } from 'fastify'
import {
  queryTobyMemberPoints,
  type TobyMemberPointsRequest,
} from '../../../lib/toby-open-api.js'
import { sendTobyResult } from './_shared.js'

const route: FastifyPluginAsync = async (app) => {
  // POST /external/toby/member/query-points — 调用 Toby 会员 A豆余额查询接口。
  app.post<{ Body: TobyMemberPointsRequest }>(
    '/external/toby/member/query-points',
    {
      schema: {
        body: {
          type: 'object',
          required: ['userId'],
          properties: {
            userId: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => sendTobyResult(reply, () => queryTobyMemberPoints(request.body)),
  )
}

export default route
