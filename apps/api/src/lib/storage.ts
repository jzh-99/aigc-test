import { TosClient } from '@volcengine/tos-sdk'
import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import crypto from 'node:crypto'

// STORAGE_DRIVER=s3 时走 S3 兼容接口（MinIO 本地开发），默认走 TOS
const USE_S3 = process.env.STORAGE_DRIVER === 's3'

// ── TOS 客户端 ────────────────────────────────────────────────────────────────
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

// ── S3 兼容客户端（MinIO 本地开发）────────────────────────────────────────────
let _s3: S3Client | null = null

function getS3(): S3Client {
  if (_s3) return _s3
  const accessKeyId = process.env.S3_ACCESS_KEY_ID ?? process.env.TOS_ACCESS_KEY_ID ?? ''
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY ?? process.env.TOS_SECRET_ACCESS_KEY ?? ''
  const endpoint = process.env.S3_ENDPOINT ?? 'http://localhost:9000'
  const region = process.env.S3_REGION ?? 'us-east-1'
  _s3 = new S3Client({
    endpoint,
    region,
    credentials: { accessKeyId, secretAccessKey },
    // MinIO 需要 path-style（不用虚拟主机风格）
    forcePathStyle: true,
  })
  return _s3
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
 * 将存储 URL 转为预签名 URL（TOS 或 S3/MinIO）。
 * 非本存储 URL（外部提供商 URL）直接返回或走加密代理。
 */
export async function signAssetUrl(storageUrl: string | null | undefined): Promise<string | null> {
  if (!storageUrl) return null

  const tosPublicUrl = process.env.TOS_PUBLIC_URL ?? ''
  const s3PublicUrl = process.env.S3_PUBLIC_URL ?? ''

  if (tosPublicUrl && storageUrl.startsWith(tosPublicUrl)) {
    // TOS 地址 → 始终用 TOS SDK 预签名，与 STORAGE_DRIVER 无关
    const key = storageUrl.slice(tosPublicUrl.length + 1)
    if (!key) return storageUrl
    try {
      const tos = getTos()
      return tos.getPreSignedUrl({ bucket: BUCKET, key, method: 'GET', expires: PRESIGN_EXPIRES })
    } catch {
      return storageUrl
    }
  }

  if (s3PublicUrl && storageUrl.startsWith(s3PublicUrl)) {
    // S3/MinIO 地址 → 用 S3 SDK 预签名
    const key = storageUrl.slice(s3PublicUrl.length + 1)
    if (!key) return storageUrl
    try {
      const cmd = new GetObjectCommand({ Bucket: BUCKET, Key: key })
      return await getSignedUrl(getS3(), cmd, { expiresIn: PRESIGN_EXPIRES })
    } catch {
      return storageUrl
    }
  }

  // 非本存储 URL
  if (storageUrl.startsWith('http://')) {
    return `/api/v1/assets/proxy?token=${encryptProxyUrl(storageUrl)}`
  }
  return storageUrl
}

/**
 * 批量并行签名多个资产 URL。
 */
export async function signAssetUrls(urls: string[]): Promise<string[]> {
  return Promise.all(urls.map(async (url) => (await signAssetUrl(url)) ?? url))
}

/**
 * 上传 Buffer 到存储（TOS 或 S3/MinIO），返回公网存储 URL（TOS_PUBLIC_URL/key）。
 */
export async function uploadToTos(
  key: string,
  body: Buffer,
  contentType: string,
): Promise<string> {
  if (USE_S3) {
    await getS3().send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body, ContentType: contentType }))
    // S3/MinIO 模式用独立的 S3_PUBLIC_URL，避免覆盖 TOS_PUBLIC_URL（worker 转存用）
    const s3PublicUrl = process.env.S3_PUBLIC_URL ?? process.env.TOS_PUBLIC_URL ?? ''
    return `${s3PublicUrl}/${key}`
  }
  const tos = getTos()
  await tos.putObject({ bucket: BUCKET, key, body, contentType })
  const publicUrl = process.env.TOS_PUBLIC_URL ?? ''
  return `${publicUrl}/${key}`
}

export async function deleteTosObject(key: string): Promise<void> {
  if (USE_S3) {
    await getS3().send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }))
  } else {
    const tos = getTos()
    await tos.deleteObject({ bucket: BUCKET, key })
  }
}

/**
 * 从存储 URL 提取 TOS object key。
 * 若 URL 不属于本存储则返回 null。
 */
export function extractStorageKey(storageUrl: string): string | null {
  const tosPublicUrl = process.env.TOS_PUBLIC_URL ?? ''
  const s3PublicUrl = process.env.S3_PUBLIC_URL ?? ''
  for (const base of [tosPublicUrl, s3PublicUrl]) {
    if (base && storageUrl.startsWith(base)) {
      const key = storageUrl.slice(base.length + 1)
      return key || null
    }
  }
  return null
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
 * 从存储读取对象为 Buffer（服务端内部使用，不预签名）。
 */
export async function getTosObjectBuffer(key: string): Promise<Buffer> {
  if (USE_S3) {
    const res = await getS3().send(new GetObjectCommand({ Bucket: BUCKET, Key: key }))
    if (!res.Body) throw new Error('Empty S3 response')
    // S3 Body 是 ReadableStream，转为 Buffer
    const chunks: Uint8Array[] = []
    for await (const chunk of res.Body as AsyncIterable<Uint8Array>) {
      chunks.push(chunk)
    }
    return Buffer.concat(chunks)
  }
  const tos = getTos()
  const res = await tos.getObjectV2({ bucket: BUCKET, key, dataType: 'buffer' })
  const content = res.data.content
  if (!content) throw new Error('Empty TOS response')
  return content as Buffer
}
