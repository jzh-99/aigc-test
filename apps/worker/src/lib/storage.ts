import { TosClient } from '@volcengine/tos-sdk'

let _tos: TosClient | null = null

export function getTos(): TosClient {
  if (_tos) return _tos
  _tos = new TosClient({
    accessKeyId: process.env.TOS_ACCESS_KEY_ID ?? '',
    accessKeySecret: process.env.TOS_SECRET_ACCESS_KEY ?? '',
    region: process.env.TOS_REGION ?? 'cn-shanghai',
    // TOS SDK endpoint 不能带协议前缀
    endpoint: (process.env.TOS_ENDPOINT ?? 'tos-cn-shanghai.volces.com').replace(/^https?:\/\//, ''),
  })
  return _tos
}

export function getBucket(): string {
  return process.env.TOS_BUCKET ?? 'toby-ai-dev'
}

export function getPublicUrl(): string {
  return process.env.TOS_PUBLIC_URL ?? `https://${getBucket()}.tos-cn-shanghai.volces.com`
}
