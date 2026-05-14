import { TosClient } from '@volcengine/tos-sdk'
import crypto from 'node:crypto'

let _tos: TosClient | null = null

function getTos(): TosClient {
  if (_tos) return _tos
  const accessKeyId = process.env.TOS_ACCESS_KEY_ID
  const accessKeySecret = process.env.TOS_SECRET_ACCESS_KEY
  if (!accessKeyId || !accessKeySecret) throw new Error('TOS_ACCESS_KEY_ID and TOS_SECRET_ACCESS_KEY are required')
  _tos = new TosClient({
    accessKeyId,
    accessKeySecret,
    region: process.env.TOS_REGION ?? 'cn-shanghai',
    // TOS SDK endpoint 不能带协议前缀
    endpoint: (process.env.TOS_ENDPOINT ?? 'tos-cn-shanghai.volces.com').replace(/^https?:\/\//, ''),
  })
  return _tos
}

const BUCKET = process.env.TOS_BUCKET ?? 'toby-ai-dev'

// 预签名 URL 有效期（秒），默认 1 小时
const PRESIGN_EXPIRES = parseInt(process.env.STORAGE_PRESIGN_EXPIRES ?? '3600', 10)

// ── 代理 URL 加密（AES-256-GCM）────────────────────────────────────────────────
// 防止存储服务器 IP 和 AI 提供商 CDN 地址暴露给前端用户

function getProxyKey(): Buffer {
  const secret = process.env.JWT_SECRET ?? ''
  return crypto.createHash('sha256').update(secret + '-proxy').digest()
}

export function encryptProxyUrl(url: string): string {
  const key = getProxyKey()
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(url, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, encrypted]).toString('base64url')
}

export function decryptProxyUrl(token: string): string | null {
  try {
    const key = getProxyKey()
    const buf = Buffer.from(token, 'base64url')
    if (buf.length < 29) return null
    const iv = buf.subarray(0, 12)
    const tag = buf.subarray(12, 28)
    const encrypted = buf.subarray(28)
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(tag)
    return decipher.update(encrypted).toString('utf8') + decipher.final('utf8')
  } catch {
    return null
  }
}
// ──────────────────────────────────────────────────────────────────────────────

/**
 * 将存储 URL 转为 TOS 预签名 URL。
 * 非本存储 URL（外部提供商 URL）直接返回或走加密代理。
 */
export async function signAssetUrl(storageUrl: string | null | undefined): Promise<string | null> {
  if (!storageUrl) return null

  const publicUrl = process.env.TOS_PUBLIC_URL ?? ''
  if (!publicUrl || !storageUrl.startsWith(publicUrl)) {
    // HTTP URL 走加密代理，隐藏内网 IP
    if (storageUrl.startsWith('http://')) {
      return `/api/v1/assets/proxy?token=${encryptProxyUrl(storageUrl)}`
    }
    // 外部 HTTPS URL（如提供商 CDN）直接返回
    return storageUrl
  }

  // 从 URL 提取 key：PUBLIC_URL/key → key
  const key = storageUrl.slice(publicUrl.length + 1)
  if (!key) return storageUrl

  try {
    const tos = getTos()
    // getPreSignedUrl 是同步方法，直接返回签名 URL 字符串
    return tos.getPreSignedUrl({ bucket: BUCKET, key, method: 'GET', expires: PRESIGN_EXPIRES })
  } catch {
    return storageUrl
  }
}

/**
 * 批量并行签名多个资产 URL。
 */
export async function signAssetUrls(urls: string[]): Promise<string[]> {
  return Promise.all(urls.map(async (url) => (await signAssetUrl(url)) ?? url))
}

/**
 * 上传 Buffer 到 TOS，返回公网存储 URL（TOS_PUBLIC_URL/key）。
 */
export async function uploadToTos(
  key: string,
  body: Buffer,
  contentType: string,
): Promise<string> {
  const tos = getTos()
  await tos.putObject({ bucket: BUCKET, key, body, contentType })
  const publicUrl = process.env.TOS_PUBLIC_URL ?? ''
  return `${publicUrl}/${key}`
}

export async function deleteTosObject(key: string): Promise<void> {
  const tos = getTos()
  await tos.deleteObject({ bucket: BUCKET, key })
}

/**
 * 从存储 URL 提取 TOS object key。
 * 若 URL 不属于本存储则返回 null。
 */
export function extractStorageKey(storageUrl: string): string | null {
  const publicUrl = process.env.TOS_PUBLIC_URL ?? ''
  if (!publicUrl || !storageUrl.startsWith(publicUrl)) return null
  const key = storageUrl.slice(publicUrl.length + 1)
  return key || null
}

function getThumbnailSecret(): string {
  return process.env.THUMBNAIL_SECRET ?? process.env.JWT_SECRET ?? ''
}

/**
 * 生成 HMAC 签名的缩略图 URL，7 天有效（按 UTC 天边界取整）。
 */
export function signThumbnailUrl(storageKey: string, width: number): string {
  const secret = getThumbnailSecret()
  if (!secret) return ''

  const dayStart = Math.floor(Date.now() / (86400 * 1000)) * 86400
  const exp = dayStart + 7 * 86400

  const data = `${storageKey}:${width}:${exp}`
  const sig = crypto.createHmac('sha256', secret).update(data).digest('hex')

  const params = new URLSearchParams({ key: storageKey, w: String(width), exp: String(exp), sig })
  return `/api/v1/assets/thumbnail?${params.toString()}`
}

/**
 * 验证缩略图 URL 的 HMAC 签名。
 */
export function verifyThumbnailSig(key: string, width: number, exp: number, sig: string): boolean {
  const secret = getThumbnailSecret()
  if (!secret) return false
  if (Date.now() / 1000 > exp) return false

  const data = `${key}:${width}:${exp}`
  const expected = crypto.createHmac('sha256', secret).update(data).digest('hex')
  try {
    const expectedBuf = Buffer.from(expected, 'hex')
    const sigBuf = Buffer.from(sig, 'hex')
    if (expectedBuf.length !== sigBuf.length) return false
    return crypto.timingSafeEqual(expectedBuf, sigBuf)
  } catch {
    return false
  }
}

/**
 * 从 TOS 读取对象为 Buffer（服务端内部使用，不预签名）。
 */
export async function getTosObjectBuffer(key: string): Promise<Buffer> {
  const tos = getTos()
  const res = await tos.getObjectV2({ bucket: BUCKET, key, dataType: 'buffer' })
  const content = res.data.content
  if (!content) throw new Error('Empty TOS response')
  return content as Buffer
}
