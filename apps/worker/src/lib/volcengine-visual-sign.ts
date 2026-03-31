/**
 * Volcengine Visual API request signing (AWS Signature V4 style).
 * Used for OmniHuman digital human generation via visual.volcengineapi.com.
 *
 * Reference: https://www.volcengine.com/docs/6369/67269
 */
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

/**
 * Build a signed fetch request for the Volcengine Visual API.
 * @param action  e.g. "CVSubmitTask" or "CVGetResult"
 * @param version e.g. "2022-08-31"
 * @param body    JSON body as plain object
 */
export function buildSignedRequest(
  action: string,
  version: string,
  body: Record<string, unknown>,
): { url: string; headers: Record<string, string>; body: string } {
  const ak = process.env.VOLCENGINE_ACCESS_KEY ?? ''
  const sk = process.env.VOLCENGINE_SECRET_KEY ?? ''

  const now = new Date()
  const datestamp = now.toISOString().slice(0, 10).replace(/-/g, '') // e.g. 20240101
  const timestamp = now.toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z' // e.g. 20240101T120000Z

  const bodyStr = JSON.stringify(body)
  const payloadHash = sha256Hex(bodyStr)

  // Query string: Action + Version
  const queryString = `Action=${encodeURIComponent(action)}&Version=${encodeURIComponent(version)}`

  // Canonical headers (must be sorted)
  const canonicalHeaders =
    `content-type:application/json\n` +
    `host:${HOST}\n` +
    `x-content-sha256:${payloadHash}\n` +
    `x-date:${timestamp}\n`
  const signedHeaders = 'content-type;host;x-content-sha256;x-date'

  const canonicalRequest = [
    'POST',
    '/',
    queryString,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n')

  const credentialScope = `${datestamp}/${REGION}/${SERVICE}/request`
  const stringToSign = [
    'HMAC-SHA256',
    timestamp,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n')

  // Derive signing key
  const kDate = hmac(sk, datestamp)
  const kRegion = hmac(kDate, REGION)
  const kService = hmac(kRegion, SERVICE)
  const kSigning = hmac(kService, 'request')
  const signature = hmac(kSigning, stringToSign).toString('hex')

  const authorization =
    `HMAC-SHA256 Credential=${ak}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, ` +
    `Signature=${signature}`

  return {
    url: `https://${HOST}/?${queryString}`,
    headers: {
      'Content-Type': 'application/json',
      Host: HOST,
      'X-Date': timestamp,
      'X-Content-Sha256': payloadHash,
      Authorization: authorization,
    },
    body: bodyStr,
  }
}
