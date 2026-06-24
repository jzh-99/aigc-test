import type { FastifyPluginAsync } from 'fastify'
import {
  notifyTobyCreationResult,
  type TobyCreationResultNotifyRequest,
} from '../../../lib/toby-open-api.js'
import { sendTobyResult } from './_shared.js'

const route: FastifyPluginAsync = async (app) => {
  // POST /external/toby/creation-result-notify — 调用 Toby 创作结果同步接口。
  app.post<{ Body: TobyCreationResultNotifyRequest }>(
    '/external/toby/creation-result-notify',
    {
      schema: {
        body: {
          type: 'object',
          required: ['userId', 'requestNo', 'workNo', 'success'],
          properties: {
            userId: { type: 'string' },
            requestNo: { type: 'string' },
            workNo: { type: 'string' },
            success: { type: 'boolean' },
            remark: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => sendTobyResult(reply, () => notifyTobyCreationResult(request.body)),
  )
}

export default route
