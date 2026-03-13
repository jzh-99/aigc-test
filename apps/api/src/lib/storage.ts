import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

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

/**
 * Convert a storage URL (e.g. http://minio:9000/bucket/key) to a presigned URL.
 * If the URL is not from our storage (e.g. external provider URL), return as-is.
 * If storage is not configured, return the URL as-is.
 */
export async function signAssetUrl(storageUrl: string | null | undefined): Promise<string | null> {
  if (!storageUrl) return null

  const publicUrl = process.env.STORAGE_PUBLIC_URL ?? ''
  if (!publicUrl || !storageUrl.startsWith(publicUrl)) {
    // If the URL is HTTP, proxy it through the API to avoid mixed-content errors on the HTTPS frontend
    if (storageUrl.startsWith('http://')) {
      return `/api/v1/assets/proxy?url=${encodeURIComponent(storageUrl)}`
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
