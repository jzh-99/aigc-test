import type { FastifyPluginAsync } from 'fastify'
import { getDb, normalizeTobyProviderModel } from '@aigc/db'
import {
  TOBY_SERVICE_CODES,
  buildTobyInboundResponse,
  decryptAndVerifyTobyInboundRequest,
  type TobyEnvelope,
  type TobySpecificationConfigPayload,
} from '../../../lib/toby-open-api.js'

const route: FastifyPluginAsync = async (app) => {
  // POST /external/toby/specification-config — Toby 模型规格同步回调，按供应商代码和模型 code 替换模型配置。
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

      const model = normalizeTobyProviderModel(payload.modelParams)
      const db = getDb()

      await db
        .insertInto('provider_models')
        .values({
          provider_code: model.provider_code,
          code: model.code,
          name: model.name,
          description: model.description,
          module: model.module,
          category_references: JSON.stringify(model.category_references),
          params_pricing: JSON.stringify(model.params_pricing),
          params_schema: JSON.stringify(model.params_schema),
          resolution: model.resolution,
          avatar: model.avatar,
          is_active: model.is_active,
        })
        .onConflict((oc) => oc.columns(['provider_code', 'code']).doUpdateSet({
          name: model.name,
          description: model.description,
          module: model.module,
          category_references: JSON.stringify(model.category_references),
          params_pricing: JSON.stringify(model.params_pricing),
          params_schema: JSON.stringify(model.params_schema),
          resolution: model.resolution,
          avatar: model.avatar,
          is_active: model.is_active,
        }))
        .execute()

      app.log.info({ providerCode: model.provider_code, modelCode: model.code }, 'Toby 模型规格同步完成')

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
