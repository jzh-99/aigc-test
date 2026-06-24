import type { FastifyReply } from 'fastify'
import type { TobyApiResponse } from '../../../lib/toby-open-api.js'

export async function sendTobyResult<T extends object>(
  reply: FastifyReply,
  action: () => Promise<TobyApiResponse<T>>,
) {
  try {
    return await action()
  } catch (err) {
    return reply.code(502).send({
      code: 'TOBY_UPSTREAM_ERROR',
      message: err instanceof Error ? err.message : 'Toby 接口调用失败',
      data: null,
    })
  }
}
