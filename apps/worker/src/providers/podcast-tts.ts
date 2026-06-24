// 播客 sami WebSocket TTS Provider（移植源项目 podcast_provider.py:PodcastProvider）。
//
// 逐方法对齐源 PodcastProvider._generate 的 WebSocket 编排：
//   1. 连接 sami（ws_url + headers：app_id/access_key/resource_id/app_key/connect_id）
//   2. start_connection → 等待 CONNECTION_STARTED_EVENT
//   3. start_session（带业务 payload + session_id）→ 等待 SESSION_STARTED_EVENT
//   4. finish_session（标记输入结束，触发 sami 开始生成）
//   5. 循环接收帧：
//      - AudioOnlyServer + PODCAST_ROUND_RESPONSE_EVENT → 音频流（仅标记 received_audio）
//      - FullServerResponse + PODCAST_ROUND_START_EVENT → 对话文本（收集 round_texts）
//      - FullServerResponse + PODCAST_END_EVENT → 提取 audio_url（sami 返回音频链接）
//      - FullServerResponse + PODCAST_ROUND_END_EVENT → 单轮结束（is_error 则抛错）
//      - SESSION_FINISHED_EVENT → 跳出循环
//   6. finish_connection → 等待 CONNECTION_FINISHED_EVENT
//   7. 返回 { audioUrl, receivedAudioStream, roundTexts, rawResponse }
//
// WebSocket 依赖：ws 包（Node 20 无原生 WebSocket，Node 22+ 才稳定；worker 统一用 ws）
// 动态 import ws，避免在测试 mock 场景强依赖真实连接
import { randomUUID } from 'node:crypto'

import {
  CONNECTION_FINISHED_EVENT,
  CONNECTION_STARTED_EVENT,
  MsgType,
  PODCAST_END_EVENT,
  PODCAST_ROUND_END_EVENT,
  PODCAST_ROUND_RESPONSE_EVENT,
  PODCAST_ROUND_START_EVENT,
  SESSION_FINISHED_EVENT,
  SESSION_STARTED_EVENT,
  buildFinishConnectionFrame,
  buildFinishSessionFrame,
  buildPodcastPayload,
  buildStartConnectionFrame,
  buildStartSessionFrame,
  extractPodcastAudioUrl,
  parsePodcastFrame,
} from './podcast-core.js'
import type { PodcastFrame } from './podcast-core.js'

// ─── WebSocket 依赖抽象（便于测试注入 mock）────────────────────────────────────
// 生产环境用 ws 包；测试可注入实现 mock 帧 I/O
export interface PodcastWebSocket {
  // 发送二进制帧
  send(data: Buffer): void
  // 接收一帧（阻塞到有数据或超时）
  recv(timeoutMs: number): Promise<Buffer>
  // 关闭连接
  close(): Promise<void>
}

// ws 包的 WebSocketLike（最小化类型约束，避免 this 类型问题）
export interface ConnectDeps {
  // 工厂：传入 url + headers，返回 PodcastWebSocket
  connect(url: string, headers: Record<string, string>, openTimeoutMs: number): Promise<PodcastWebSocket>
}

// ─── Provider 生成结果（对齐源 ExternalTaskResult）──────────────────────────────
export interface PodcastTtsResult {
  // sami 返回的音频链接（临时 URL，worker 需转存 TOS）
  audioUrl: string
  // 是否收到音频流帧（诊断用，对齐源 received_audio_stream）
  receivedAudioStream: boolean
  // 对话文本片段（对齐源 round_texts，后续安全检测用）
  roundTexts: string[]
  // sami 原始响应（PODCAST_END_EVENT 的 payload，记录供应商日志用）
  rawResponse: Record<string, unknown>
}

// ─── 连接配置（对齐源 PodcastProvider.__init__ 参数）───────────────────────────
export interface PodcastTtsConfig {
  wsUrl: string
  appId: string
  accessKey: string
  resourceId: string
  appKey: string
  timeoutSeconds: number
}

// ─── headers 生成（对齐源 PodcastProvider._headers）───────────────────────────
// X-Api-Connect-Id 每次连接生成新 UUID（对齐源 str(uuid4())）
export function buildSamiHeaders(config: PodcastTtsConfig): Record<string, string> {
  return {
    'X-Api-App-Id': config.appId,
    'X-Api-Access-Key': config.accessKey,
    'X-Api-Resource-Id': config.resourceId,
    'X-Api-App-Key': config.appKey,
    'X-Api-Connect-Id': randomUUID(),
  }
}

// ─── 接收单帧（对齐源 receive_message）─────────────────────────────────────────
async function receiveMessage(ws: PodcastWebSocket, timeoutMs: number): Promise<PodcastFrame> {
  const message = await ws.recv(timeoutMs)
  // 字符串帧转 Buffer（对齐源 isinstance(message, str) 分支）
  const buf = typeof message === 'string' ? Buffer.from(message, 'utf-8') : message
  return parsePodcastFrame(buf)
}

// ─── 等待特定事件（对齐源 wait_for_event）──────────────────────────────────────
// type/event 不匹配则抛错（协议状态机强校验）
async function waitForEvent(
  ws: PodcastWebSocket,
  messageType: MsgType,
  event: number,
  timeoutMs: number,
): Promise<PodcastFrame> {
  const frame = await receiveMessage(ws, timeoutMs)
  if (frame.type !== messageType || frame.event !== event) {
    throw new Error(
      `Unexpected podcast event type=${MsgType[frame.type]} event=${frame.event}, expected type=${MsgType[messageType]} event=${event}`,
    )
  }
  return frame
}

// ─── 发送帧（对齐源 _send_frame）────────────────────────────────────────────────
async function sendFrame(ws: PodcastWebSocket, frame: Buffer): Promise<void> {
  ws.send(frame)
}

// ─── 主生成方法（对齐源 PodcastProvider._generate 的完整状态机）──────────────────
export async function generatePodcast(params: {
  config: PodcastTtsConfig
  taskId: string
  contentType: 'text' | 'file' | 'url'
  content: string
  speakers: string[]
  connectDeps: ConnectDeps
}): Promise<PodcastTtsResult> {
  const { config, taskId, contentType, content, speakers, connectDeps } = params
  // 构造业务 payload（input_text/input_url/speaker_info 等）
  const payload = buildPodcastPayload(taskId, contentType, content, speakers)
  // session_id 复用 task_id（对齐源 task_id or str(uuid4())）
  const sessionId = taskId || randomUUID()

  let audioUrl: string | null = null
  let rawResponse: Record<string, unknown> = {}
  let receivedAudio = false
  const roundTexts: string[] = []

  const timeoutMs = config.timeoutSeconds * 1000
  const ws = await connectDeps.connect(config.wsUrl, buildSamiHeaders(config), timeoutMs)
  try {
    // 步骤 1：start_connection → 等 CONNECTION_STARTED
    await sendFrame(ws, buildStartConnectionFrame())
    await waitForEvent(ws, MsgType.FullServerResponse, CONNECTION_STARTED_EVENT, timeoutMs)

    // 步骤 2：start_session（带业务 payload）→ 等 SESSION_STARTED
    await sendFrame(ws, buildStartSessionFrame(payload, sessionId))
    await waitForEvent(ws, MsgType.FullServerResponse, SESSION_STARTED_EVENT, timeoutMs)

    // 步骤 3：finish_session（标记输入结束，触发 sami 开始生成）
    await sendFrame(ws, buildFinishSessionFrame(sessionId))

    // 步骤 4：循环接收帧直到 SESSION_FINISHED
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const frame = await receiveMessage(ws, timeoutMs)
      // 音频流帧（仅标记，不收集二进制 —— sami 通过 return_audio_url 返回完整链接）
      if (frame.type === MsgType.AudioOnlyServer && frame.event === PODCAST_ROUND_RESPONSE_EVENT) {
        receivedAudio = true
        continue
      }
      // 单轮对话文本（收集用于后续安全检测）
      if (frame.type === MsgType.FullServerResponse && frame.event === PODCAST_ROUND_START_EVENT) {
        const text = frame.payload.text as string | undefined
        if (text) roundTexts.push(text)
        continue
      }
      // 生成结束帧：提取 audio_url
      if (frame.type === MsgType.FullServerResponse && frame.event === PODCAST_END_EVENT) {
        rawResponse = frame.payload
        audioUrl = extractPodcastAudioUrl(frame)
        continue
      }
      // 单轮结束帧：is_error 则抛错
      if (frame.type === MsgType.FullServerResponse && frame.event === PODCAST_ROUND_END_EVENT) {
        if (frame.payload.is_error) {
          const errorMessage = String(frame.payload.error_msg ?? 'Podcast round failed')
          const errorCode = (frame.payload.status_code as string | number) ?? (frame.payload.code as string | number) ?? frame.event
          // 延迟 import 避免循环依赖
          const { PodcastProviderError, podcastUserErrorMessage } = await import('./podcast-core.js')
          throw new PodcastProviderError(
            errorMessage,
            podcastUserErrorMessage(errorCode as string, errorMessage),
            String(errorCode),
          )
        }
        continue
      }
      // 会话结束：跳出循环
      if (frame.event === SESSION_FINISHED_EVENT) {
        break
      }
    }

    // 步骤 5：finish_connection → 等 CONNECTION_FINISHED
    await sendFrame(ws, buildFinishConnectionFrame())
    await waitForEvent(ws, MsgType.FullServerResponse, CONNECTION_FINISHED_EVENT, timeoutMs)
  } finally {
    await ws.close()
  }

  if (!audioUrl) {
    throw new Error('Podcast response missing audio url')
  }
  return {
    audioUrl,
    receivedAudioStream: receivedAudio,
    roundTexts,
    rawResponse,
  }
}

// ─── 生产环境 ws 连接工厂（动态 import ws 包）──────────────────────────────────
export function createWsConnectDeps(): ConnectDeps {
  return {
    async connect(url, headers, openTimeoutMs) {
      // 动态 import，避免在无 ws 环境下模块加载失败
      const wsModule = (await import('ws')) as unknown as {
        default?: { new (url: string, protocols?: string | string[], options?: Record<string, unknown>): RawWebSocket }
        WebSocket?: { new (url: string, protocols?: string | string[], options?: Record<string, unknown>): RawWebSocket }
      }
      const WebSocketCtor = wsModule.default ?? wsModule.WebSocket
      if (!WebSocketCtor) {
        throw new Error('ws 包未正确加载')
      }
      return new Promise<PodcastWebSocket>((resolve, reject) => {
        let settled = false
        const timer = setTimeout(() => {
          if (!settled) {
            settled = true
            reject(new Error(`WebSocket connect timeout after ${openTimeoutMs}ms`))
          }
        }, openTimeoutMs)

        const wsRef = new WebSocketCtor(url, undefined, {
          headers,
          handshakeTimeout: openTimeoutMs,
        })
        const incomingQueue: Buffer[] = []
        let waiter: ((data: Buffer) => void) | null = null

        wsRef.on('open', () => {
          if (!settled) {
            settled = true
            clearTimeout(timer)
            resolve({
              send(data: Buffer) {
                wsRef.send(data)
              },
              async recv(timeoutMs: number): Promise<Buffer> {
                // 队列有数据直接返回，否则等 message 事件
                const cached = incomingQueue.shift()
                if (cached) return cached
                return new Promise<Buffer>((res, rej) => {
                  const t = setTimeout(() => rej(new Error(`WebSocket recv timeout after ${timeoutMs}ms`)), timeoutMs)
                  waiter = (data) => {
                    clearTimeout(t)
                    waiter = null
                    res(data)
                  }
                })
              },
              async close() {
                try {
                  wsRef.close()
                } catch {
                  /* 已关闭则忽略 */
                }
              },
            })
          }
        })

        wsRef.on('message', (data: Buffer) => {
          // 优先唤醒等待中的 recv，否则入队等后续 recv 消费
          if (waiter) {
            const w = waiter
            waiter = null
            w(data)
          } else {
            incomingQueue.push(data)
          }
        })

        wsRef.on('error', (err: Error) => {
          if (!settled) {
            settled = true
            clearTimeout(timer)
            reject(err)
          } else {
            // 连接建立后出错，唤醒等待中的 recv
            if (waiter) {
              const w = waiter
              waiter = null
              w(Buffer.alloc(0))
            }
          }
        })
      })
    },
  }
}

// ws 包的最小化类型约束（避免导入完整类型导致的 this 约束）
// on 方法用 any listener 规避 ws 复杂重载签名的逆变问题
interface RawWebSocket {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event: string, listener: (...args: any[]) => void): this
  send(data: Buffer): void
  close(): void
}
