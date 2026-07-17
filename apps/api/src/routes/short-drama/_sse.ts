import type { FastifyReply } from 'fastify'

/**
 * 短剧 SSE 会话封装。
 *
 * 统一处理四个文本生成路由（summary / episode-outlines / asset-prompts / segments）
 * 共有的 SSE 写入逻辑，解决两个问题：
 * 1. 客户端连接中断后向 `reply.raw` 写入会抛错（EPIPE/destroyed），
 *    旧代码会让这种「流写入失败」误触发 catch 分支（重复退积分 + 状态覆盖）。
 *    这里把所有写入做成「断连静默失败」，业务层据此用 persisted 标志判断真实成败。
 * 2. 暴露 `clientSignal`：客户端断开时 abort，传给 callQwenForTextStream 的 externalSignal，
 *    及时中止 AI 上游请求，避免空跑浪费 token。
 */
export interface ShortDramaSSESession {
  /** 发送 SSE 事件，连接已断开/已结束时静默失败，返回是否成功写入 */
  sendEvent: (event: string, data: unknown) => boolean
  /** 发送心跳注释行（保活，连接断开时静默忽略） */
  sendPing: () => void
  /** 客户端断开信号，传给 callQwenForTextStream 的 externalSignal */
  readonly clientSignal: AbortSignal
  /** 安全结束响应（已结束则跳过，避免重复 end 抛错） */
  end: () => void
}

/**
 * 创建短剧 SSE 会话。需在 reply.hijack() 之后、开始写入之前调用。
 */
export function createShortDramaSSESession(reply: FastifyReply): ShortDramaSSESession {
  const raw = reply.raw
  const clientController = new AbortController()

  // 客户端断开（或响应正常结束）时触发 abort。
  // 正常结束时 AI 调用已完成，abort 无副作用；真正断开时则及时中止 AI 上游请求。
  raw.on('close', () => clientController.abort())

  // 底层连接是否仍可写：已销毁或已调用 end() 后不可写
  const isWritable = (): boolean => !raw.destroyed && !raw.writableEnded

  const sendEvent = (event: string, data: unknown): boolean => {
    if (!isWritable()) return false
    try {
      return raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    } catch {
      // 连接已断开等场景，写入失败静默处理，由调用方按 persisted 标志判断真实业务结果
      return false
    }
  }

  const sendPing = (): void => {
    if (!isWritable()) return
    try {
      raw.write(': ping\n\n')
    } catch {
      // 心跳写入失败（连接已断）忽略
    }
  }

  const end = (): void => {
    if (raw.writableEnded) return
    try {
      raw.end()
    } catch {
      // 忽略结束时的写入错误
    }
  }

  return { sendEvent, sendPing, clientSignal: clientController.signal, end }
}
