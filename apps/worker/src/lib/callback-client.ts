import crypto from 'node:crypto'

/**
 * 开放接口异步回调 HTTP 客户端
 *
 * 严格对齐源项目 app/services/callbacks.py 的 CallbackClient：
 * 1. body 序列化为紧凑 JSON（无多余空格、不转义非 ASCII 字符），
 *    等价 Python `json.dumps(payload, ensure_ascii=False, separators=(",", ":"))`。
 * 2. 请求头固定：
 *    - Content-Type: application/json
 *    - X-Timestamp: 当前毫秒时间戳（13 位）
 *    - X-Signature: `sha256=<hex>`，HMAC-SHA256(secret, rawBody) 的十六进制摘要
 *    （注意：签名输入仅含 body 字节，不含 timestamp；与源 _signature 一致）
 * 3. 成功判定：HTTP 2xx（fetch 的 res.ok）；非 2xx 抛错触发上层重试。
 * 4. 超时：AbortController 在 timeoutSeconds 秒后中止请求。
 */
export class CallbackClient {
  constructor(
    private readonly timeoutSeconds: number,
    private readonly signatureSecret: string,
  ) {}

  async post(callbackUrl: string, payload: Record<string, unknown>): Promise<void> {
    // JSON.stringify 默认无多余空格、不转义非 ASCII 字符，等价 Python 的紧凑序列化
    const rawBody = Buffer.from(JSON.stringify(payload), 'utf-8')

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutSeconds * 1000)

    try {
      const response = await fetch(callbackUrl, {
        method: 'POST',
        body: rawBody,
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'X-Timestamp': String(Date.now()),
          'X-Signature': this.signatureOf(rawBody),
        },
      })
      // 对齐源 raise_for_status()：非 2xx 抛错
      if (!response.ok) {
        throw new Error(`callback http ${response.status}`)
      }
    } finally {
      clearTimeout(timer)
    }
  }

  /**
   * 计算签名：HMAC-SHA256(secret, rawBody) 的十六进制摘要，前缀 `sha256=`
   *
   * 注意：签名输入仅含 body 字节，不含 timestamp（源 _signature 同样不含）。
   */
  private signatureOf(rawBody: Buffer): string {
    const hex = crypto.createHmac('sha256', this.signatureSecret).update(rawBody).digest('hex')
    return `sha256=${hex}`
  }
}
