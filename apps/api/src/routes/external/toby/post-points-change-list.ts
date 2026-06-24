import type { FastifyPluginAsync } from 'fastify'
import {
  queryTobyPointsChangeList,
  type TobyPointsChangeQueryRequest,
} from '../../../lib/toby-open-api.js'
import { sendTobyResult } from './_shared.js'

const route: FastifyPluginAsync = async (app) => {
  // POST /external/toby/points/change-list — 调用 Toby A豆流水查询接口。
  app.post<{ Body: TobyPointsChangeQueryRequest }>(
    '/external/toby/points/change-list',
    {
      schema: {
        body: {
          type: 'object',
          required: ['userId', 'pageNum', 'pageSize'],
          properties: {
            userId: { type: 'string' },
            changeType: { type: 'string' },
            pageNum: { type: 'integer', minimum: 1 },
            pageSize: { type: 'integer', minimum: 1, maximum: 100 },
          },
        },
      },
    },
    async (request, reply) => sendTobyResult(reply, () => queryTobyPointsChangeList(request.body)),
  )
}

export default route
