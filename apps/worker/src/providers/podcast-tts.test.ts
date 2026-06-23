// 播客 sami WebSocket TTS Provider 测试（Phase 5）。
//
// 测试目标：验证 generatePodcast 的完整 WebSocket 状态机编排正确性：
//   - mock PodcastWebSocket（记录发送的帧 + 按脚本回放服务端帧）
//   - 验证客户端发送帧序列：start_connection → start_session → finish_session → finish_connection
//   - 验证服务端帧处理：CONNECTION_STARTED / SESSION_STARTED / ROUND_START(收集text) /
//     ROUND_RESPONSE(标记音频) / PODCAST_END(提取audio_url) / SESSION_FINISHED / CONNECTION_FINISHED
//   - 验证返回结果：audioUrl / receivedAudioStream / roundTexts
//   - 错误场景：sami 返回 Error 帧 → 抛 PodcastProviderError
//   - 错误场景：状态机不匹配（期望 CONNECTION_STARTED 但收到其他）→ 抛错
//
// 不连接真实 sami：用 mock PodcastWebSocket 注入 connectDeps，帧来自 podcast-core（已字节级对齐源）
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'

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
  buildPodcastFrame,
} from './podcast-core.js'
import {
  generatePodcast,
  buildSamiHeaders,
  type PodcastWebSocket,
  type ConnectDeps,
  type PodcastTtsConfig,
} from './podcast-tts.js'

// ─── mock PodcastWebSocket：记录发送帧 + 按脚本回放服务端帧 ──────────────────────
class MockPodcastWebSocket implements PodcastWebSocket {
  // 记录客户端发送的所有帧（便于断言帧序列）
  sentFrames: Buffer[] = []
  // 服务端待回放的帧脚本（按顺序消费）
  private script: Buffer[] = []
  closed = false

  constructor(script: Buffer[]) {
    this.script = [...script]
  }

  send(data: Buffer): void {
    this.sentFrames.push(data)
  }

  async recv(_timeoutMs: number): Promise<Buffer> {
    const next = this.script.shift()
    if (!next) {
      throw new Error('Mock WS script exhausted（服务端帧已用尽）')
    }
    return next
  }

  async close(): Promise<void> {
    this.closed = true
  }
}

// 构造服务端帧（FullServerResponse 类型）
function serverFrame(event: number, sessionId: string | null, payload: Record<string, unknown>): Buffer {
  return buildPodcastFrame({ event, sessionId, payload, messageType: MsgType.FullServerResponse })
}

// 构造音频帧（AudioOnlyServer + RAW serialization）
function audioFrame(event: number, sessionId: string, audioBytes: Buffer): Buffer {
  return buildPodcastFrame({
    event,
    sessionId,
    payload: audioBytes,
    messageType: MsgType.AudioOnlyServer,
    serialization: 0x00,
  })
}

// 完整成功流程的服务端帧脚本（对齐源 _generate 的接收序列）
function buildSuccessScript(sessionId: string): Buffer[] {
  return [
    // start_connection 后：等 CONNECTION_STARTED
    serverFrame(CONNECTION_STARTED_EVENT, null, {}),
    // start_session 后：等 SESSION_STARTED
    serverFrame(SESSION_STARTED_EVENT, sessionId, { session: 'ok' }),
    // finish_session 后：进入生成循环
    // 对话文本（收集 roundTexts）
    serverFrame(PODCAST_ROUND_START_EVENT, sessionId, { text: '主播A：大家好' }),
    // 音频流（标记 receivedAudioStream）
    audioFrame(PODCAST_ROUND_RESPONSE_EVENT, sessionId, Buffer.from('audio-chunk-1')),
    serverFrame(PODCAST_ROUND_START_EVENT, sessionId, { text: '主播B：欢迎收听' }),
    audioFrame(PODCAST_ROUND_RESPONSE_EVENT, sessionId, Buffer.from('audio-chunk-2')),
    // 单轮结束（is_error=false）
    serverFrame(PODCAST_ROUND_END_EVENT, sessionId, { is_error: false }),
    // 生成结束（提取 audio_url）
    serverFrame(
      PODCAST_END_EVENT,
      sessionId,
      { meta_info: { audio_url: 'https://sami.example.com/temp-audio.mp3' } },
    ),
    // 会话结束（跳出循环）
    serverFrame(SESSION_FINISHED_EVENT, sessionId, {}),
    // finish_connection 后：等 CONNECTION_FINISHED
    serverFrame(CONNECTION_FINISHED_EVENT, null, {}),
  ]
}

const TEST_CONFIG: PodcastTtsConfig = {
  wsUrl: 'wss://sami.example.com/ws',
  appId: 'test-app-id',
  accessKey: 'test-access-key',
  resourceId: 'test-resource-id',
  appKey: 'test-app-key',
  timeoutSeconds: 5,
}

// 构造 mock connectDeps（注入 mock WS）
function mockConnectDeps(script: Buffer[]): { deps: ConnectDeps; ws: MockPodcastWebSocket } {
  const ws = new MockPodcastWebSocket(script)
  const deps: ConnectDeps = {
    async connect(_url, _headers, _openTimeoutMs) {
      return ws
    },
  }
  return { deps, ws }
}

// ─── 完整成功流程 ──────────────────────────────────────────────────────────────
describe('generatePodcast（完整成功流程）', () => {
  test('按状态机走完全流程，返回 audioUrl + roundTexts + receivedAudioStream', async () => {
    const sessionId = 'task-001'
    const { deps, ws } = mockConnectDeps(buildSuccessScript(sessionId))

    const result = await generatePodcast({
      config: TEST_CONFIG,
      taskId: sessionId,
      contentType: 'text',
      content: '一段播客内容',
      speakers: ['voice_a', 'voice_b'],
      connectDeps: deps,
    })

    // 验证返回结果
    assert.equal(result.audioUrl, 'https://sami.example.com/temp-audio.mp3')
    assert.equal(result.receivedAudioStream, true)
    assert.deepEqual(result.roundTexts, ['主播A：大家好', '主播B：欢迎收听'])
    assert.ok(result.rawResponse.meta_info)

    // 验证客户端发送帧序列：start_connection → start_session → finish_session → finish_connection
    assert.equal(ws.sentFrames.length, 4, '应发送 4 个客户端帧')

    // 验证连接已关闭
    assert.equal(ws.closed, true, 'WebSocket 应已关闭')
  })

  test('content_type=url：payload 走 input_url 分支', async () => {
    const sessionId = 'task-002'
    const { deps, ws } = mockConnectDeps(buildSuccessScript(sessionId))

    const result = await generatePodcast({
      config: TEST_CONFIG,
      taskId: sessionId,
      contentType: 'url',
      content: 'https://example.com/article',
      speakers: ['voice_a', 'voice_b'],
      connectDeps: deps,
    })

    assert.equal(result.audioUrl, 'https://sami.example.com/temp-audio.mp3')
    // start_session 帧的 payload 应含 input_info.input_url
    const startSessionFrame = ws.sentFrames[1]
    assert.ok(startSessionFrame.includes(Buffer.from('input_url', 'utf-8')))
  })
})

// ─── 错误场景 ──────────────────────────────────────────────────────────────────
describe('generatePodcast（错误场景）', () => {
  test('sami 返回 Error 帧（PODCAST_ROUND_END is_error）→ 抛 PodcastProviderError', async () => {
    const sessionId = 'task-err'
    const script = [
      serverFrame(CONNECTION_STARTED_EVENT, null, {}),
      serverFrame(SESSION_STARTED_EVENT, sessionId, {}),
      // 单轮失败（is_error=true，含 error_msg + status_code）
      serverFrame(PODCAST_ROUND_END_EVENT, sessionId, {
        is_error: true,
        error_msg: 'content filter triggered',
        status_code: '50302102',
      }),
    ]
    const { deps } = mockConnectDeps(script)

    await assert.rejects(
      () =>
        generatePodcast({
          config: TEST_CONFIG,
          taskId: sessionId,
          contentType: 'text',
          content: '敏感内容',
          speakers: ['voice_a', 'voice_b'],
          connectDeps: deps,
        }),
      (err: unknown) => {
        const e = err as Error & { publicMessage: string | null; errorCode: string | null }
        assert.match(e.message, /content filter triggered/)
        assert.equal(e.errorCode, '50302102')
        assert.equal(e.publicMessage, '含敏感信息')
        return true
      },
    )
  })

  test('状态机不匹配（期望 CONNECTION_STARTED 但收到 SESSION_STARTED）→ 抛错', async () => {
    const sessionId = 'task-mismatch'
    const script = [
      // 错误：start_connection 后应回 CONNECTION_STARTED，但回 SESSION_STARTED
      serverFrame(SESSION_STARTED_EVENT, null, {}),
    ]
    const { deps } = mockConnectDeps(script)

    await assert.rejects(
      () =>
        generatePodcast({
          config: TEST_CONFIG,
          taskId: sessionId,
          contentType: 'text',
          content: 'x',
          speakers: ['a', 'b'],
          connectDeps: deps,
        }),
      (err: unknown) => {
        assert.match((err as Error).message, /Unexpected podcast event/)
        return true
      },
    )
  })

  test('PODCAST_END 帧无 audio_url → 抛 missing audio url', async () => {
    const sessionId = 'task-no-audio'
    const script = [
      serverFrame(CONNECTION_STARTED_EVENT, null, {}),
      serverFrame(SESSION_STARTED_EVENT, sessionId, {}),
      // PODCAST_END 但无 meta_info.audio_url
      serverFrame(PODCAST_END_EVENT, sessionId, { meta_info: {} }),
      serverFrame(SESSION_FINISHED_EVENT, sessionId, {}),
      serverFrame(CONNECTION_FINISHED_EVENT, null, {}),
    ]
    const { deps } = mockConnectDeps(script)

    await assert.rejects(
      () =>
        generatePodcast({
          config: TEST_CONFIG,
          taskId: sessionId,
          contentType: 'text',
          content: 'x',
          speakers: ['a', 'b'],
          connectDeps: deps,
        }),
      (err: unknown) => {
        assert.match((err as Error).message, /missing audio url/)
        return true
      },
    )
  })
})

// ─── headers 生成 ──────────────────────────────────────────────────────────────
describe('buildSamiHeaders（sami 认证 headers）', () => {
  test('包含全部 5 个 X-Api-* 字段，且 Connect-Id 为 UUID 格式', () => {
    const headers = buildSamiHeaders(TEST_CONFIG)
    assert.equal(headers['X-Api-App-Id'], 'test-app-id')
    assert.equal(headers['X-Api-Access-Key'], 'test-access-key')
    assert.equal(headers['X-Api-Resource-Id'], 'test-resource-id')
    assert.equal(headers['X-Api-App-Key'], 'test-app-key')
    // Connect-Id 为 UUID v4 格式（对齐源 str(uuid4())）
    assert.match(headers['X-Api-Connect-Id'], /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
  })

  test('每次调用 Connect-Id 不同', () => {
    const h1 = buildSamiHeaders(TEST_CONFIG)
    const h2 = buildSamiHeaders(TEST_CONFIG)
    assert.notEqual(h1['X-Api-Connect-Id'], h2['X-Api-Connect-Id'])
  })
})
