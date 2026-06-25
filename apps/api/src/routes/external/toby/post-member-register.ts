import type { FastifyPluginAsync } from 'fastify'
import {
  registerTobyMember,
  type TobyMemberRegisterRequest,
} from '../../../lib/toby-open-api.js'
import { sendTobyResult } from './_shared.js'

const route: FastifyPluginAsync = async (app) => {
  // POST /external/toby/member/register — 调用 Toby 个人会员注册接口。
  app.post<{ Body: TobyMemberRegisterRequest }>(
    '/external/toby/member/register',
    {
      schema: {
        body: {
          type: 'object',
          required: ['phone', 'userName', 'channel'],
          properties: {
            phone: { type: 'string' },
            userName: { type: 'string' },
            channel: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => sendTobyResult(reply, () => registerTobyMember(request.body)),
  )
}

export default route
