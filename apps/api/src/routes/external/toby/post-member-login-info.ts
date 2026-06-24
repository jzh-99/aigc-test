import type { FastifyPluginAsync } from 'fastify'
import {
  queryTobyMemberLoginInfo,
  type TobyMemberLoginInfoRequest,
} from '../../../lib/toby-open-api.js'
import { sendTobyResult } from './_shared.js'

const route: FastifyPluginAsync = async (app) => {
  // POST /external/toby/member/login-info — 调用 Toby 会员信息查询接口。
  app.post<{ Body: TobyMemberLoginInfoRequest }>(
    '/external/toby/member/login-info',
    {
      schema: {
        body: {
          type: 'object',
          required: ['phone', 'userName', 'channel', 'userType'],
          properties: {
            phone: { type: 'string' },
            userName: { type: 'string' },
            compName: { type: 'string' },
            channel: { type: 'string' },
            userType: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => sendTobyResult(reply, () => queryTobyMemberLoginInfo(request.body)),
  )
}

export default route
