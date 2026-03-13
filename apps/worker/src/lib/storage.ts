import { S3Client } from '@aws-sdk/client-s3'

let _s3: S3Client | null = null

export function getS3(): S3Client {
  if (_s3) return _s3
  _s3 = new S3Client({
    endpoint: process.env.STORAGE_ENDPOINT ?? 'http://localhost:9000',
    region: process.env.STORAGE_REGION ?? 'us-east-1',
    credentials: {
      accessKeyId: process.env.STORAGE_ACCESS_KEY ?? '',
      secretAccessKey: process.env.STORAGE_SECRET_KEY ?? '',
    },
    forcePathStyle: true,
  })
  return _s3
}

export function getBucket(): string {
  return process.env.STORAGE_BUCKET ?? 'aigc-assets'
}

export function getPublicUrl(): string {
  return process.env.STORAGE_PUBLIC_URL ?? 'http://localhost:9000/aigc-assets'
}
