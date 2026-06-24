// 播客 sami WebSocket 帧协议单元测试（Phase 5）。
//
// 测试目标：验证移植自源项目 podcast_provider.py 的帧编解码「逐字节对齐」源 Python 实现。
// 红线：帧二进制布局必须与源完全一致（sami 协议是二进制协议，错一个字节都会握手失败）。
//
// 验证方式：用源 Python 脚本生成的「期望帧十六进制」做严格对比（golden file 风格），
// 涵盖：
//   - 客户端帧构造：start_connection / start_session / finish_session / finish_connection
//   - 服务端帧解析：CONNECTION_STARTED / SESSION_STARTED / ROUND_START / PODCAST_END /
//     SESSION_FINISHED / CONNECTION_FINISHED / AudioOnlyServer 音频帧
//   - payload 构造：text / url 两种 content_type
//   - audio_url 提取：PODCAST_END_EVENT 的 meta_info.audio_url
//   - 错误帧解析：Error 类型帧抛 PodcastProviderError（含用户文案）
//   - 边界：帧过短抛错
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'

import {
  MsgType,
  buildPodcastFrame,
  buildPodcastPayload,
  parsePodcastFrame,
  extractPodcastAudioUrl,
  podcastUserErrorMessage,
  PodcastProviderError,
  buildStartConnectionFrame,
  buildStartSessionFrame,
  buildFinishSessionFrame,
  buildFinishConnectionFrame,
  START_CONNECTION_EVENT,
  START_SESSION_EVENT,
  FINISH_SESSION_EVENT,
  FINISH_CONNECTION_EVENT,
  CONNECTION_STARTED_EVENT,
  SESSION_STARTED_EVENT,
  SESSION_FINISHED_EVENT,
  CONNECTION_FINISHED_EVENT,
  PODCAST_ROUND_START_EVENT,
  PODCAST_ROUND_END_EVENT,
  PODCAST_END_EVENT,
  PODCAST_ROUND_RESPONSE_EVENT,
} from './podcast-core.js'

// buffer 转 hex（对齐源 Python bytes.hex()，小写无分隔）
function toHex(buf: Buffer): string {
  return buf.toString('hex')
}

// hex 字符串转 Buffer（解析源生成的期望帧）
function fromHex(hex: string): Buffer {
  return Buffer.from(hex, 'hex')
}

// ─── 源 Python 生成的期望帧十六进制（golden values）──────────────────────────────
// 由源 app/providers/podcast_provider.py 的 build_podcast_frame 生成，TS 实现必须逐字节对齐
const GOLDEN = {
  start_connection: '1114100000000001000000027b7d',
  finish_connection: '1114100000000002000000027b7d',
  parse_connection_started: '1194100000000032000000087b226f6b223a317d',
  parse_connection_finished: '1194100000000034000000027b7d',
} as const

// ─── 客户端帧构造：逐字节对齐源 ──────────────────────────────────────────────
describe('buildPodcastFrame（客户端帧构造，逐字节对齐源 Python）', () => {
  test('start_connection：无 sessionId + 空 payload', () => {
    // header: 0x11(header_size=1) | 0x14(FullClientRequest=0x01<<4 | EVENT_FLAG=0x04) | 0x10(JSON) | 0x00
    // event: 0x00000001(START_CONNECTION)
    // sessionId 长度: 无（sessionId=null 不写）
    // payload 长度: 0x00000002，payload: "{}"
    const frame = buildStartConnectionFrame()
    assert.equal(toHex(frame), GOLDEN.start_connection)
  })

  test('finish_connection：无 sessionId + 空 payload', () => {
    const frame = buildFinishConnectionFrame()
    assert.equal(toHex(frame), GOLDEN.finish_connection)
  })

  test('start_session：带 sessionId + 完整业务 payload', () => {
    // 源生成的完整帧（含 input_text/speaker_info 等全部字段）
    const expected =
      '1114100000000064000000087461736b2d313233000001657b22696e7075745f6964223a227461736b2d31' +
      '3233222c22616374696f6e223a302c227363656e65223a22646565705f7265736561726368222c227573655f68' +
      '6561645f6d75736963223a747275652c227573655f7461696c5f6d75736963223a747275652c22616967635f77' +
      '617465726d61726b223a747275652c22696e7075745f696e666f223a7b2272657475726e5f617564696f5f7572' +
      '6c223a747275652c22696e7075745f746578745f6d61785f6c656e677468223a353030307d2c22617564696f5f' +
      '636f6e666967223a7b22666f726d6174223a226d7033222c2273616d706c655f72617465223a32343030302c22' +
      '7370656563685f72617465223a307d2c22737065616b65725f696e666f223a7b2272616e646f6d5f6f72646572' +
      '223a747275652c22737065616b657273223a5b22766f6963655f61222c22766f6963655f62225d7d2c22696e70' +
      '75745f74657874223a2268656c6c6f20776f726c64227d'
    const payload = buildPodcastPayload('task-123', 'text', 'hello world', ['voice_a', 'voice_b'])
    const frame = buildStartSessionFrame(payload, 'task-123')
    assert.equal(toHex(frame), expected)
  })

  test('finish_session：带 sessionId + 空 payload', () => {
    const expected = '1114100000000066000000087461736b2d313233000000027b7d'
    const frame = buildFinishSessionFrame('task-123')
    assert.equal(toHex(frame), expected)
  })

  test('帧头字节布局：header_size=1 / type<<4|EVENT_FLAG / serialization|NO_COMPRESSION', () => {
    const frame = buildPodcastFrame({ event: START_CONNECTION_EVENT, sessionId: null, payload: {} })
    // [0]=0x11: header_size 低 4 位=1（1 个 4 字节组）
    assert.equal(frame[0] & 0x0f, 1)
    // [1]=0x14: FullClientRequest(0x01)<<4 | EVENT_FLAG(0x04)
    assert.equal(frame[1], (MsgType.FullClientRequest << 4) | 0x04)
    // [2]=0x10: JSON_SERIALIZATION(0x10) | NO_COMPRESSION(0x00)
    assert.equal(frame[2], 0x10)
    // [3]=0x00 保留
    assert.equal(frame[3], 0x00)
  })

  test('isError=true 时帧头 type 为 Error(0x0F)', () => {
    const frame = buildPodcastFrame({
      event: START_CONNECTION_EVENT,
      sessionId: null,
      payload: {},
      isError: true,
    })
    assert.equal(frame[1] >> 4, MsgType.Error)
  })
})

// ─── 服务端帧解析：逐字节对齐源 ──────────────────────────────────────────────
describe('parsePodcastFrame（服务端帧解析，逐字节对齐源 Python）', () => {
  test('CONNECTION_STARTED：无 sessionId + JSON payload', () => {
    const frame = parsePodcastFrame(fromHex(GOLDEN.parse_connection_started))
    assert.equal(frame.type, MsgType.FullServerResponse)
    assert.equal(frame.event, CONNECTION_STARTED_EVENT)
    assert.equal(frame.sessionId, '')
    assert.deepEqual(frame.payload, { ok: 1 })
    assert.equal(frame.isError, false)
  })

  test('CONNECTION_FINISHED：无 sessionId + 空 payload', () => {
    const frame = parsePodcastFrame(fromHex(GOLDEN.parse_connection_finished))
    assert.equal(frame.type, MsgType.FullServerResponse)
    assert.equal(frame.event, CONNECTION_FINISHED_EVENT)
    assert.equal(frame.sessionId, '')
    assert.deepEqual(frame.payload, {})
  })

  test('SESSION_STARTED：带 sessionId + JSON payload', () => {
    // 源生成：sessionId='task-123'，payload={'session':'ok'}
    const hex = '1194100000000096000000087461736b2d313233000000107b2273657373696f6e223a226f6b227d'
    const frame = parsePodcastFrame(fromHex(hex))
    assert.equal(frame.type, MsgType.FullServerResponse)
    assert.equal(frame.event, SESSION_STARTED_EVENT)
    assert.equal(frame.sessionId, 'task-123')
    assert.deepEqual(frame.payload, { session: 'ok' })
  })

  test('SESSION_FINISHED：带 sessionId + 空 payload', () => {
    const hex = '1194100000000098000000087461736b2d313233000000027b7d'
    const frame = parsePodcastFrame(fromHex(hex))
    assert.equal(frame.event, SESSION_FINISHED_EVENT)
    assert.equal(frame.sessionId, 'task-123')
    assert.deepEqual(frame.payload, {})
  })

  test('PODCAST_ROUND_START：带 sessionId + text', () => {
    const hex = '1194100000000168000000087461736b2d313233000000177b2274657874223a22726f756e6420746578742031227d'
    const frame = parsePodcastFrame(fromHex(hex))
    assert.equal(frame.event, PODCAST_ROUND_START_EVENT)
    assert.equal(frame.sessionId, 'task-123')
    assert.equal(frame.payload.text, 'round text 1')
  })

  test('PODCAST_END：带 sessionId + meta_info.audio_url', () => {
    const hex = '119410000000016b000000087461736b2d3132330000003b7b226d6574615f696e666f223a7b22617564696f5f75726c223a2268747470733a2f2f6578616d706c652e636f6d2f617564696f2e6d7033227d7d'
    const frame = parsePodcastFrame(fromHex(hex))
    assert.equal(frame.event, PODCAST_END_EVENT)
    assert.equal(frame.sessionId, 'task-123')
    const audioUrl = extractPodcastAudioUrl(frame)
    assert.equal(audioUrl, 'https://example.com/audio.mp3')
  })

  test('AudioOnlyServer 音频帧：RAW serialization + 二进制 payload', () => {
    // 源生成：type=AudioOnlyServer(0x0B)，serialization=RAW(0x00)，payload=b'binary-audio-data'
    const hex = '11b4000000000169000000087461736b2d3132330000001162696e6172792d617564696f2d64617461'
    const frame = parsePodcastFrame(fromHex(hex))
    assert.equal(frame.type, MsgType.AudioOnlyServer)
    assert.equal(frame.event, PODCAST_ROUND_RESPONSE_EVENT)
    assert.equal(frame.sessionId, 'task-123')
    // RAW serialization（frame[2]>>4 != 1）→ payload 为空对象，原始字节在 payloadBytes
    assert.deepEqual(frame.payload, {})
    assert.equal(frame.payloadBytes.toString('utf-8'), 'binary-audio-data')
  })

  test('错误帧（MsgType.Error）抛 PodcastProviderError', () => {
    // 构造一个 Error 帧：type=Error(0x0F)，event=PODCAST_ROUND_END，payload 含 error + code
    const errorFrame = buildPodcastFrame({
      event: PODCAST_ROUND_END_EVENT,
      sessionId: 'task-123',
      payload: { error: 'content filter triggered', code: '50302102' },
      isError: true,
    })
    assert.throws(
      () => parsePodcastFrame(errorFrame),
      (err: unknown) => {
        assert.ok(err instanceof PodcastProviderError, '应抛 PodcastProviderError')
        assert.equal((err as PodcastProviderError).errorCode, '50302102')
        // 50302102 + 'content filter' → 用户文案 '含敏感信息'
        assert.equal((err as PodcastProviderError).publicMessage, '含敏感信息')
        return true
      },
    )
  })

  test('帧过短（<12 字节）抛错', () => {
    assert.throws(() => parsePodcastFrame(Buffer.from('0001', 'hex')))
  })
})

// ─── payload 构造 ──────────────────────────────────────────────────────────────
describe('buildPodcastPayload（业务载荷构造）', () => {
  test('content_type=text：写入 input_text', () => {
    const payload = buildPodcastPayload('task-123', 'text', 'hello', ['a', 'b'])
    assert.equal(payload.input_text, 'hello')
    assert.equal(payload.input_id, 'task-123')
    assert.equal(payload.scene, 'deep_research')
    assert.equal(payload.use_head_music, true)
    assert.deepEqual(payload.audio_config, { format: 'mp3', sample_rate: 24000, speech_rate: 0 })
    assert.deepEqual(payload.speaker_info, { random_order: true, speakers: ['a', 'b'] })
    assert.deepEqual(payload.input_info, { return_audio_url: true, input_text_max_length: 5000 })
  })

  test('content_type=url：写入 input_info.input_url', () => {
    const payload = buildPodcastPayload('task-123', 'url', 'https://x.com', ['a', 'b'])
    assert.equal(payload.input_text, undefined)
    assert.deepEqual(payload.input_info, {
      return_audio_url: true,
      input_text_max_length: 5000,
      input_url: 'https://x.com',
    })
  })

  test('content_type=file + http URL：写入 input_info.input_url（TOS URL 透传）', () => {
    const payload = buildPodcastPayload('task-123', 'file', 'https://tos.example.com/x.pdf', ['a', 'b'])
    assert.deepEqual(payload.input_info, {
      return_audio_url: true,
      input_text_max_length: 5000,
      input_url: 'https://tos.example.com/x.pdf',
    })
  })

  test('content_type=file + 非 URL base64：抛错（路由层应已转 TOS）', () => {
    assert.throws(() =>
      buildPodcastPayload('task-123', 'file', 'data:application/pdf;base64,xxx', ['a', 'b']),
    )
  })
})

// ─── 错误码用户文案映射 ──────────────────────────────────────────────────────────
describe('podcastUserErrorMessage（错误码 → 用户文案）', () => {
  test('50302102 + content filter → 含敏感信息', () => {
    assert.equal(podcastUserErrorMessage('50302102', 'content filter triggered'), '含敏感信息')
  })
  test('50302102 + content length → 不符合创作规范', () => {
    assert.equal(podcastUserErrorMessage('50302102', 'content length too long'), '不符合创作规范')
  })
  test('45000000 → 不符合创作规范', () => {
    assert.equal(podcastUserErrorMessage('45000000', 'any'), '不符合创作规范')
  })
  test('未知错误码 → null（透传通用文案）', () => {
    assert.equal(podcastUserErrorMessage('99999999', 'unknown'), null)
  })
})

// ─── extractPodcastAudioUrl ─────────────────────────────────────────────────────
describe('extractPodcastAudioUrl', () => {
  test('非 PODCAST_END_EVENT 返回 null', () => {
    const frame = { event: SESSION_STARTED_EVENT, payload: { meta_info: { audio_url: 'x' } } } as never
    assert.equal(extractPodcastAudioUrl(frame), null)
  })
  test('PODCAST_END_EVENT 但无 meta_info 返回 null', () => {
    const frame = { event: PODCAST_END_EVENT, payload: {} } as never
    assert.equal(extractPodcastAudioUrl(frame), null)
  })
})
