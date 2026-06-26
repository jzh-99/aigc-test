import type { FastifyReply } from 'fastify'
import type { TobyApiResponse } from '../../../lib/toby-open-api.js'

export async function sendTobyResult<T extends object>(
  reply: FastifyReply,
  action: () => Promise<TobyApiResponse<T>>,
) {
  try {
    return await action()
  } catch (err) {
    // Toby 上游接口异常：打印完整错误便于排查外部平台故障，再以 502 返回客户端
    reply.log.error({ err }, 'Toby 上游接口调用失败')
    return reply.code(502).send({
      code: 'TOBY_UPSTREAM_ERROR',
      message: err instanceof Error ? err.message : 'Toby 接口调用失败',
      data: null,
    })
  }
}
