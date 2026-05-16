import { log } from 'node:console'
import crypto from 'node:crypto'

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
  const ak = process.env.VOLCENGINE_ACCESS_KEY ?? ''
  const sk = process.env.VOLCENGINE_SECRET_KEY ?? ''

  const now = new Date()

  // 1. 日期：纯数字 20260516
  const datestamp = now.toISOString().split('T')[0].replace(/-/g, '')

  // 2. ✅ 关键：强制去掉毫秒！！！火山唯一认可格式
  const fullIsoTime = now.toISOString().split('.')[0] + 'Z' // 2026-05-16T08:10:52Z

  log('datestamp:', datestamp)
  log('fullIsoTime:', fullIsoTime)

  const bodyStr = JSON.stringify(body)
  const payloadHash = sha256Hex(bodyStr)
  const queryString = `Action=${action}&Version=${version}`

  const canonicalHeaders =
    `content-type:application/json\n` +
    `host:${HOST}\n` +
    `x-content-sha256:${payloadHash}\n` +
    `x-date:${fullIsoTime}\n`

  const signedHeaders = 'content-type;host;x-content-sha256;x-date'

  const canonicalRequest = [
    'POST', '/', '',
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