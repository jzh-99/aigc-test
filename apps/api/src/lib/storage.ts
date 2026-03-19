import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import crypto from 'node:crypto'

let _s3: S3Client | null = null

function getS3(): S3Client {
  if (_s3) return _s3
  const endpoint = process.env.STORAGE_ENDPOINT
  if (!endpoint) throw new Error('STORAGE_ENDPOINT is required')
  const accessKey = process.env.STORAGE_ACCESS_KEY
  const secretKey = process.env.STORAGE_SECRET_KEY
  if (!accessKey || !secretKey) throw new Error('STORAGE_ACCESS_KEY and STORAGE_SECRET_KEY are required')
  _s3 = new S3Client({
    endpoint,
    region: process.env.STORAGE_REGION ?? 'us-east-1',
    credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
    forcePathStyle: true,
  })
  return _s3
}

const BUCKET = process.env.STORAGE_BUCKET ?? 'aigc-assets'

// Presigned URL expiration in seconds (default 1 hour)
const PRESIGN_EXPIRES = parseInt(process.env.STORAGE_PRESIGN_EXPIRES ?? '3600', 10)

// ── Proxy URL encryption (AES-256-GCM) ────────────────────────────────────────
// Prevents storage server IP and AI provider CDN addresses from being
// visible to users in proxy query parameters.

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
    if (buf.length < 29) return null // min: 12 IV + 16 tag + 1 char
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
 * Convert a storage URL (e.g. http://minio:9000/bucket/key) to a presigned URL.
 * If the URL is not from our storage (e.g. external provider URL), return as-is.
 * If storage is not configured, return the URL as-is.
 */
export async function signAssetUrl(storageUrl: string | null | undefined): Promise<string | null> {
  if (!storageUrl) return null

  const publicUrl = process.env.STORAGE_PUBLIC_URL ?? ''
  if (!publicUrl || !storageUrl.startsWith(publicUrl)) {
    // If the URL is HTTP, encrypt and proxy it — hides storage server IP
    if (storageUrl.startsWith('http://')) {
      return `/api/v1/assets/proxy?token=${encryptProxyUrl(storageUrl)}`
    }
    // External HTTPS URL (e.g. provider CDN) — return as-is
    return storageUrl
  }

  // Extract key from URL: PUBLIC_URL/key → key
  const key = storageUrl.slice(publicUrl.length + 1) // +1 for the /
  if (!key) return storageUrl

  try {
    const s3 = getS3()
    const command = new GetObjectCommand({ Bucket: BUCKET, Key: key })
    return await getSignedUrl(s3 as any, command, { expiresIn: PRESIGN_EXPIRES })
  } catch {
    // If S3 is not configured, return original URL
    return storageUrl
  }
}

/**
 * Sign multiple asset URLs in parallel.
 */
export async function signAssetUrls(urls: string[]): Promise<string[]> {
  return Promise.all(urls.map(async (url) => (await signAssetUrl(url)) ?? url))
}

/**
 * Extract the S3 object key from a storage URL.
 * Returns null if the URL is not from our storage.
 */
export function extractStorageKey(storageUrl: string): string | null {
  const publicUrl = process.env.STORAGE_PUBLIC_URL ?? ''
  if (!publicUrl || !storageUrl.startsWith(publicUrl)) return null
  const key = storageUrl.slice(publicUrl.length + 1)
  return key || null
}

function getThumbnailSecret(): string {
  return process.env.THUMBNAIL_SECRET ?? process.env.JWT_SECRET ?? ''
}

/**
 * Create an HMAC-signed thumbnail URL that is stable for 7 days (keyed to UTC day boundary).
 * Returns empty string if no secret is configured.
 */
export function signThumbnailUrl(storageKey: string, width: number): string {
  const secret = getThumbnailSecret()
  if (!secret) return ''

  // Round to start of current UTC day; valid until start of day + 7 days
  const dayStart = Math.floor(Date.now() / (86400 * 1000)) * 86400
  const exp = dayStart + 7 * 86400

  const data = `${storageKey}:${width}:${exp}`
  const sig = crypto.createHmac('sha256', secret).update(data).digest('hex')

  const params = new URLSearchParams({ key: storageKey, w: String(width), exp: String(exp), sig })
  return `/api/v1/assets/thumbnail?${params.toString()}`
}

/**
 * Verify an HMAC-signed thumbnail URL signature.
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
 * Fetch an S3 object as a Buffer (no presigning — for internal server use only).
 */
export async function getS3ObjectBuffer(key: string): Promise<Buffer> {
  const s3 = getS3()
  const command = new GetObjectCommand({ Bucket: BUCKET, Key: key })
  const response = await s3.send(command) as any
  if (!response.Body) throw new Error('Empty S3 response')
  const chunks: Uint8Array[] = []
  for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}
