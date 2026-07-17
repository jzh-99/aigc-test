import { TosClient } from '@volcengine/tos-sdk'

let _tos: TosClient | null = null
const DEFAULT_TOS_ENDPOINT = 'tos-cn-shanghai.volces.com'

export function normalizeTosEndpoint(endpoint: string | undefined): string {
  const rawEndpoint = (endpoint ?? DEFAULT_TOS_ENDPOINT).trim()
  if (!rawEndpoint) return DEFAULT_TOS_ENDPOINT

  try {
    if (/^https?:\/\//i.test(rawEndpoint)) {
      return new URL(rawEndpoint).host
    }
  } catch {
    return rawEndpoint.replace(/^https?:\/\//i, '').split('/')[0] || DEFAULT_TOS_ENDPOINT
  }

  return rawEndpoint.replace(/^https?:\/\//i, '').split('/')[0].replace(/\/+$/, '') || DEFAULT_TOS_ENDPOINT
}

type TosAxiosClient = {
  axiosInst?: {
    interceptors?: {
      request?: {
        use?: (onFulfilled: (config: { proxy?: unknown }) => { proxy: false }) => unknown
      }
    }
  }
}

export function disableTosAxiosEnvProxy(client: unknown): void {
  const axiosInst = (client as TosAxiosClient).axiosInst
  axiosInst?.interceptors?.request?.use?.((config) => ({ ...config, proxy: false }))
}

function getUrlProtocol(url: string | undefined): string | null {
  if (!url) return null
  try {
    return new URL(url).protocol
  } catch {
    return null
  }
}

export function getStorageRuntimeInfo() {
  const httpsProxy = process.env.https_proxy ?? process.env.HTTPS_PROXY
  const httpProxy = process.env.http_proxy ?? process.env.HTTP_PROXY
  return {
    tosEndpoint: normalizeTosEndpoint(process.env.TOS_ENDPOINT),
    tosPublicUrlProtocol: getUrlProtocol(process.env.TOS_PUBLIC_URL),
    tosBucket: getBucket(),
    httpsProxyProtocol: getUrlProtocol(httpsProxy),
    httpProxyProtocol: getUrlProtocol(httpProxy),
    tosAxiosEnvProxyDisabled: true,
  }
}

export function getTos(): TosClient {
  if (_tos) return _tos
  _tos = new TosClient({
    accessKeyId: process.env.TOS_ACCESS_KEY_ID ?? '',
    accessKeySecret: process.env.TOS_SECRET_ACCESS_KEY ?? '',
    region: process.env.TOS_REGION ?? 'cn-shanghai',
    // TOS SDK endpoint 不能带协议前缀；显式 secure=true，避免被外部环境误导为 http。
    endpoint: normalizeTosEndpoint(process.env.TOS_ENDPOINT),
    secure: true,
  })
  // axios 0.21 会自动读取 http_proxy/https_proxy；在 HTTPS TOS 请求下遇到 HTTP 代理会混用 Agent。
  disableTosAxiosEnvProxy(_tos)
  return _tos
}

export function getBucket(): string {
  return process.env.TOS_BUCKET ?? 'toby-ai-dev'
}

export function getPublicUrl(): string {
  return process.env.TOS_PUBLIC_URL ?? `https://${getBucket()}.tos-cn-shanghai.volces.com`
}
