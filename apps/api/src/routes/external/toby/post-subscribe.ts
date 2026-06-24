import type { FastifyPluginAsync } from 'fastify'
import {
  syncTobySubscribe,
  type TobySubscribeRequest,
} from '../../../lib/toby-open-api.js'
import { sendTobyResult } from './_shared.js'

const route: FastifyPluginAsync = async (app) => {
  // POST /external/toby/subscribe — 调用 Toby 订购同步接口。
  app.post<{ Body: TobySubscribeRequest }>(
    '/external/toby/subscribe',
    {
      schema: {
        body: {
          type: 'object',
          required: ['requestNo', 'exOrderNo', 'phone', 'channel', 'source', 'goodsId', 'orderType', 'payAmount', 'status'],
          properties: {
            requestNo: { type: 'string' },
            exOrderNo: { type: 'string' },
            phone: { type: 'string' },
            channel: { type: 'integer' },
            source: { type: 'string' },
            goodsId: { type: 'string' },
            orderType: { type: 'integer' },
            payAmount: { anyOf: [{ type: 'number' }, { type: 'string' }] },
            status: { type: 'integer' },
            orderTime: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => sendTobyResult(reply, () => syncTobySubscribe(request.body)),
  )
}

export default route
