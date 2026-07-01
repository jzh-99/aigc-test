import crypto from 'node:crypto'
import { volcengineConfig } from '@aigc/nacos-config'

const REGION = 'cn-north-1'
const SERVICE = 'cv'
const HOST = 'visual.volcengineapi.com'

function hmac(key: Buffer | string, data: string): Buffer {
  return crypto.createHmac('sha256', key).update(data, 'utf8').digest()
}

function sha256Hex(data: string): string {
  return crypto.createHash('sha256').update(data, 'utf8').digest('hex')
}

export function buildSignedRequest(
  action: string,
  version: string,
  body: Record<string, unknown>,
): { url: string; headers: Record<string, string>; body: string } {
  const ak = volcengineConfig.accessKey
  const sk = volcengineConfig.secretKey

  const now = new Date()

  // 火山引擎签名要求紧凑格式（类 AWS SigV4）：YYYYMMDD 和 YYYYMMDDTHHMMSSZ，不含分隔符
  const datestamp = now.toISOString().split('T')[0].replace(/-/g, '') // 20260518
  const fullIsoTime = now.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z' // 20260518T154038Z

  const bodyStr = JSON.stringify(body)
  const payloadHash = sha256Hex(bodyStr)
  // Action 在 V 前，字母顺序已排好
  const queryString = `Action=${action}&Version=${version}`

  const canonicalHeaders =
    `content-type:application/json\n` +
    `host:${HOST}\n` +
    `x-content-sha256:${payloadHash}\n` +
    `x-date:${fullIsoTime}\n`

  const signedHeaders = 'content-type;host;x-content-sha256;x-date'

  // CanonicalQueryString 必须与实际 URL 查询参数一致，不能留空
  const canonicalRequest = [
    'POST', '/', queryString,
    canonicalHeaders,
    signedHeaders,
    payloadHash
  ].join('\n')

  const credentialScope = `${datestamp}/${REGION}/${SERVICE}/request`
  const stringToSign = [
    'HMAC-SHA256',
    fullIsoTime,
    credentialScope,
    sha256Hex(canonicalRequest)
  ].join('\n')

  const kDate = hmac(sk, datestamp)
  const kRegion = hmac(kDate, REGION)
  const kService = hmac(kRegion, SERVICE)
  const kSigning = hmac(kService, 'request')
  const signature = hmac(kSigning, stringToSign).toString('hex')

  const authorization = `HMAC-SHA256 Credential=${ak}/${credentialScope},SignedHeaders=${signedHeaders},Signature=${signature}`

  return {
    url: `https://${HOST}/?${queryString}`,
    headers: {
      'Content-Type': 'application/json',
      'X-Date': fullIsoTime,
      'X-Content-Sha256': payloadHash,
      Authorization: authorization
    },
    body: bodyStr
  }
}
