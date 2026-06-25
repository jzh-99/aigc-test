import type { FastifyPluginAsync } from 'fastify'
import {
  TOBY_SERVICE_CODES,
  buildTobyInboundResponse,
  decryptAndVerifyTobyInboundRequest,
  type TobyEnvelope,
  type TobySpecificationConfigPayload,
} from '../../../lib/toby-open-api.js'

const route: FastifyPluginAsync = async (app) => {
  // POST /external/toby/specification-config — Toby 模型规格同步回调，目前仅解密验签并打印数据。
  app.post<{ Body: TobyEnvelope }>(
    '/external/toby/specification-config',
    {
      schema: {
        tags: ['外部接口'],
        summary: 'Toby 模型规格同步回调',
        body: {
          type: 'object',
          required: ['appID', 'requestJson'],
          properties: {
            appID: { type: 'string' },
            requestJson: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      let payload: TobySpecificationConfigPayload

      try {
        payload = decryptAndVerifyTobyInboundRequest<TobySpecificationConfigPayload>(
          request.body,
          TOBY_SERVICE_CODES.specificationConfig,
        )
      } catch (err) {
        app.log.warn({ err }, 'Toby 模型规格同步回调验签或解密失败')
        return reply.code(400).send({
          code: '1000',
          message: err instanceof Error ? err.message : 'Toby 请求解密或验签失败',
          data: null,
        })
      }

      app.log.info({ payload }, '收到 Toby 模型规格同步数据')

      return {
        code: '0000',
        message: 'success',
        data: buildTobyInboundResponse(TOBY_SERVICE_CODES.specificationConfig, {
          requestNo: String(payload.requestNo ?? ''),
          status: '0',
        }),
      }
    },
  )
}

export default route
