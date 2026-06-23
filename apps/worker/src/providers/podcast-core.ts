// 播客 sami WebSocket TTS 帧协议 —— 纯逻辑层（移植源项目 podcast_provider.py）。
//
// 本文件逐字段逐方法对齐源项目 app/providers/podcast_provider.py 的帧编解码：
//   - 事件常量（START_CONNECTION_EVENT 等）
//   - 序列化/标志位常量（JSON_SERIALIZATION / RAW_SERIALIZATION / EVENT_FLAG）
//   - MsgType 枚举（FullClientRequest / FullServerResponse / AudioOnlyServer / Error）
//   - buildPodcastPayload：构造请求载荷（input_text/input_url/speaker_info 等）
//   - buildPodcastFrame：客户端→服务端帧的二进制拼装
//   - parsePodcastFrame：服务端→客户端帧的二进制解析（含错误帧抛错）
//   - extractPodcastAudioUrl：从 PODCAST_END_EVENT 帧提取 audio_url
//
// 纯逻辑抽离到独立文件，便于单测：不依赖 ws / fetch / TOS，仅做 Buffer 数学运算。
// 错误码用户文案对齐源 app/providers/podcast_errors.py 的映射表。

// ─── 事件常量（对齐源 podcast_provider.py:14-26）─────────────────────────────
export const START_CONNECTION_EVENT = 1
export const FINISH_CONNECTION_EVENT = 2
export const CONNECTION_STARTED_EVENT = 50
export const CONNECTION_FINISHED_EVENT = 52
export const START_SESSION_EVENT = 100
export const FINISH_SESSION_EVENT = 102
export const SESSION_STARTED_EVENT = 150
export const SESSION_FINISHED_EVENT = 152
export const USAGE_RESPONSE_EVENT = 154
export const PODCAST_ROUND_START_EVENT = 360
export const PODCAST_ROUND_RESPONSE_EVENT = 361
export const PODCAST_ROUND_END_EVENT = 362
export const PODCAST_END_EVENT = 363

// ─── 序列化/标志位常量（对齐源 podcast_provider.py:28-31）─────────────────────
export const JSON_SERIALIZATION = 0x10
export const RAW_SERIALIZATION = 0x00
export const NO_COMPRESSION = 0x00
export const EVENT_FLAG = 0x04

// ─── MsgType 枚举（对齐源 podcast_provider.py:34-38 的 IntEnum）─────────────────
// 帧头第 2 字节高 4 位表示消息类型（frame[1] >> 4）
export enum MsgType {
  FullClientRequest = 0x01,
  FullServerResponse = 0x09,
  AudioOnlyServer = 0x0b,
  Error = 0x0f,
}

// ─── PodcastFrame dataclass（对齐源 podcast_provider.py:42-48）─────────────────
export interface PodcastFrame {
  type: MsgType
  event: number
  sessionId: string
  payloadBytes: Buffer
  payload: Record<string, unknown>
  isError: boolean
}

// ─── 播客生成请求载荷（对齐源 podcast_provider.py:51-78 build_podcast_payload）─
// speakers 为字符串数组（源 schemas/podcast.py: list[str]，恰好 2 个）
export function buildPodcastPayload(
  taskId: string,
  contentType: 'text' | 'file' | 'url',
  content: string,
  speakers: string[],
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    input_id: taskId,
    action: 0,
    scene: 'deep_research',
    use_head_music: true,
    use_tail_music: true,
    aigc_watermark: true,
    // 返回音频链接，设置最大输入长度，保证模型稳定
    input_info: { return_audio_url: true, input_text_max_length: 5000 },
    audio_config: { format: 'mp3', sample_rate: 24000, speech_rate: 0 },
    speaker_info: { random_order: true, speakers },
  }
  if (contentType === 'text') {
    payload.input_text = content
    return payload
  }
  if (contentType === 'url') {
    ;(payload.input_info as Record<string, unknown>).input_url = content
    return payload
  }
  // content_type === 'file'：content 已在路由/worker 层转成 TOS URL（PDF base64 脱敏落 TOS）
  if (contentType === 'file' && (content.startsWith('http://') || content.startsWith('https://'))) {
    ;(payload.input_info as Record<string, unknown>).input_url = content
    return payload
  }
  throw new Error(`Unsupported podcast content_type: ${contentType}`)
}

// ─── JSON 载荷编码（对齐源 podcast_provider.py:81-84 _encode_payload）──────────
function encodePayload(payload: Record<string, unknown> | Buffer): Buffer {
  if (Buffer.isBuffer(payload)) return payload
  return Buffer.from(JSON.stringify(payload), 'utf-8')
}

// ─── 构建客户端→服务端帧（对齐源 podcast_provider.py:87-103 build_podcast_frame）─
// 帧二进制布局（逐字节对齐源）：
//   [0]              0x11（header_size=1 个 4 字节组，低 4 位=1）
//   [1]              (msgType << 4) | EVENT_FLAG
//   [2]              serialization | NO_COMPRESSION
//   [3]              0x00（保留）
//   [4..7]           event（big-endian uint32）
//   [8..11]          sessionId 长度（big-endian uint32，sessionId 非空时）
//   [12..]           sessionId UTF-8 字节（sessionId 非空时）
//   [next 4 bytes]   payload 长度（big-endian uint32）
//   [剩余]           payload 字节
export function buildPodcastFrame(params: {
  event: number
  sessionId?: string | null
  payload: Record<string, unknown> | Buffer
  isError?: boolean
  messageType?: MsgType
  serialization?: number
}): Buffer {
  const {
    event,
    sessionId,
    payload,
    isError = false,
    messageType = MsgType.FullClientRequest,
    serialization = JSON_SERIALIZATION,
  } = params
  const frameType = isError ? MsgType.Error : messageType
  const header = Buffer.from([0x11, (frameType << 4) | EVENT_FLAG, serialization | NO_COMPRESSION, 0x00])
  const payloadBytes = encodePayload(payload)
  const parts: Buffer[] = [header, writeUInt32BE(event)]
  if (sessionId != null) {
    const sessionBytes = Buffer.from(sessionId, 'utf-8')
    parts.push(writeUInt32BE(sessionBytes.length), sessionBytes)
  }
  parts.push(writeUInt32BE(payloadBytes.length), payloadBytes)
  return Buffer.concat(parts)
}

// 大端序 uint32 写入 4 字节 Buffer（对齐 Python int.to_bytes(4, 'big')）
function writeUInt32BE(value: number): Buffer {
  const buf = Buffer.alloc(4)
  buf.writeUInt32BE(value >>> 0, 0)
  return buf
}

// ─── PodcastProviderError（对齐源 podcast_errors.py:17-21）─────────────────────
export class PodcastProviderError extends Error {
  readonly publicMessage: string | null
  readonly errorCode: string | null
  constructor(message: string, publicMessage: string | null = null, errorCode: string | null = null) {
    super(message)
    this.name = 'PodcastProviderError'
    this.publicMessage = publicMessage
    this.errorCode = errorCode
  }
}

// ─── 错误码 → 用户文案映射（对齐源 podcast_errors.py:1-8 PODCAST_USER_ERROR_MESSAGES）─
const PODCAST_USER_ERROR_MESSAGES: Record<string, string> = {
  '45000000': '不符合创作规范',
  '40000010': '不符合创作规范',
  '55000000': '不符合创作规范',
  '50302102.content_filter': '含敏感信息',
  '50302102.content_length': '不符合创作规范',
  '50302102.empty_outline': '不符合创作规范',
}

// 不可重试错误码集合（对齐源 PODCAST_NON_RETRYABLE_ERROR_CODES，当前为空集 —— 全部走重试）
export const PODCAST_NON_RETRYABLE_ERROR_CODES: ReadonlySet<string> = new Set()

// ─── 错误码 → 用户文案（对齐源 podcast_errors.py:24-36 podcast_user_error_message）─
export function podcastUserErrorMessage(
  errorCode: number | string | null,
  errorMessage: string | null,
): string | null {
  const code = errorCode != null ? String(errorCode) : null
  const normalized = (errorMessage ?? '').toLowerCase()
  if (code === '50302102') {
    if (normalized.includes('content filter')) {
      return PODCAST_USER_ERROR_MESSAGES['50302102.content_filter']
    }
    if (normalized.includes('content length')) {
      return PODCAST_USER_ERROR_MESSAGES['50302102.content_length']
    }
    if (normalized.includes('get outline base model return empty')) {
      return PODCAST_USER_ERROR_MESSAGES['50302102.empty_outline']
    }
  }
  if (code != null && code in PODCAST_USER_ERROR_MESSAGES) {
    return PODCAST_USER_ERROR_MESSAGES[code]
  }
  return null
}

// ─── 解析服务端→客户端帧（对齐源 podcast_provider.py:106-156 parse_podcast_frame）─
// 解析逻辑（逐行对齐源）：
//   1. header_size = frame[0] & 0x0F；offset = header_size * 4
//   2. message_type = frame[1] >> 4
//   3. event = readUInt32BE(offset)；offset += 4
//   4. first_length = readUInt32BE(offset)；first_payload_start = offset + 4
//   5. 若 first_payload_end == frame.length：payload 直接是 first_payload 区间（无 sessionId）
//      否则：sessionId = first_payload 区间，payload 紧跟 sessionId 后 4 字节长度 + 数据
//   6. payload 按 serialization（frame[2] >> 4 === 1 → JSON）解码
//   7. Error 帧抛 PodcastProviderError（含用户文案）
export function parsePodcastFrame(frame: Buffer): PodcastFrame {
  if (frame.length < 12) {
    throw new Error('Podcast frame is too short')
  }
  const headerSize = frame[0] & 0x0f
  let offset = headerSize * 4
  if (offset < 4 || frame.length < offset + 8) {
    throw new Error('Podcast frame is too short')
  }
  const messageType = (frame[1] >> 4) as MsgType
  const event = frame.readUInt32BE(offset)
  offset += 4

  let sessionId = ''
  const firstLength = frame.readUInt32BE(offset)
  const firstPayloadStart = offset + 4
  const firstPayloadEnd = firstPayloadStart + firstLength
  let payloadStart: number
  let payloadEnd: number
  if (firstPayloadEnd === frame.length) {
    payloadStart = firstPayloadStart
    payloadEnd = firstPayloadEnd
  } else {
    const sessionStart = firstPayloadStart
    const sessionEnd = sessionStart + firstLength
    const payloadSizeEnd = sessionEnd + 4
    if (frame.length < payloadSizeEnd) {
      throw new Error('Podcast frame missing payload size')
    }
    sessionId = frame.subarray(sessionStart, sessionEnd).toString('utf-8')
    const payloadLength = frame.readUInt32BE(sessionEnd)
    payloadStart = payloadSizeEnd
    payloadEnd = payloadStart + payloadLength
    if (payloadEnd > frame.length) {
      throw new Error('Podcast frame payload is incomplete')
    }
  }

  const payloadBytes = frame.subarray(payloadStart, payloadEnd)
  const isJson = (frame[2] >> 4) === 0x01
  const payload = isJson ? decodeJsonPayload(payloadBytes) : {}
  if (messageType === MsgType.Error) {
    const message =
      (payload.error as string) ??
      (payload.message as string) ??
      payloadBytes.toString('utf-8')
    const externalCode = (payload.code as string | number) ?? event
    throw new PodcastProviderError(
      `Podcast WebSocket error event=${event} payload=${message}`,
      podcastUserErrorMessage(externalCode as string, message),
      String(externalCode),
    )
  }
  return {
    type: messageType,
    event,
    sessionId,
    payloadBytes: Buffer.from(payloadBytes),
    payload,
    isError: false,
  }
}

function decodeJsonPayload(payloadBytes: Buffer): Record<string, unknown> {
  if (payloadBytes.length === 0) return {}
  return JSON.parse(payloadBytes.toString('utf-8')) as Record<string, unknown>
}

// ─── 提取 audio_url（对齐源 podcast_provider.py:165-168 extract_podcast_audio_url）─
export function extractPodcastAudioUrl(frame: PodcastFrame): string | null {
  if (frame.event !== PODCAST_END_EVENT) return null
  const metaInfo = (frame.payload.meta_info as Record<string, unknown> | undefined) ?? undefined
  return (metaInfo?.audio_url as string) ?? null
}

// ─── 便捷帧构造（对齐源 start_connection / finish_connection / start_session / finish_session）─
export function buildStartConnectionFrame(): Buffer {
  return buildPodcastFrame({ event: START_CONNECTION_EVENT, sessionId: null, payload: {} })
}

export function buildFinishConnectionFrame(): Buffer {
  return buildPodcastFrame({ event: FINISH_CONNECTION_EVENT, sessionId: null, payload: {} })
}

export function buildStartSessionFrame(payload: Record<string, unknown>, sessionId: string): Buffer {
  return buildPodcastFrame({ event: START_SESSION_EVENT, sessionId, payload })
}

export function buildFinishSessionFrame(sessionId: string): Buffer {
  return buildPodcastFrame({ event: FINISH_SESSION_EVENT, sessionId, payload: {} })
}
