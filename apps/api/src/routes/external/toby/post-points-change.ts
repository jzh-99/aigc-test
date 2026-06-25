import type { FastifyPluginAsync } from 'fastify'
import {
  deductTobyPoints,
  type TobyPointsChangeRequest,
} from '../../../lib/toby-open-api.js'
import { sendTobyResult } from './_shared.js'

const route: FastifyPluginAsync = async (app) => {
  // POST /external/toby/points/change — 调用 Toby A豆扣减接口。
  app.post<{ Body: TobyPointsChangeRequest }>(
    '/external/toby/points/change',
    {
      schema: {
        body: {
          type: 'object',
          required: ['userId', 'requestNo', 'source', 'workNo', 'pointsNum'],
          properties: {
            userId: { type: 'string' },
            requestNo: { type: 'string' },
            source: { type: 'integer' },
            workNo: { type: 'string' },
            pointsNum: { anyOf: [{ type: 'number' }, { type: 'string' }] },
            remark: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => sendTobyResult(reply, () => deductTobyPoints(request.body)),
  )
}

export default route
