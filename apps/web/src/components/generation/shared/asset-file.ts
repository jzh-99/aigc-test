import { resolveAssetFetchUrl } from './asset-url'
import { fetchRawWithAuth } from '@/lib/fetch-with-auth'

type AssetFetcher = (url: string, init?: RequestInit) => Promise<Response>

export async function fetchAssetFile(
  url: string,
  assetType: string,
  baseName: string,
  // 默认带 JWT 鉴权：线上 TOS 资源经 resolveAssetFetchUrl 改写为 /api/v1/assets/fetch 代理路径，
  // 该接口需要 Bearer token；调用方不传 fetcher 时默认走鉴权 fetch，避免遗漏导致 401「素材加载失败」。
  // （本地 MinIO 的 host 不命中代理改写，直接 fetch 原始 URL，故本地无法复现该问题）
  fetcher: AssetFetcher = fetchRawWithAuth,
): Promise<File> {
  const resp = await fetcher(resolveAssetFetchUrl(url))
  if (!resp.ok) throw new Error('fetch failed')
  const blob = await resp.blob()
  const fallbackExt = assetType === 'video' ? 'mp4' : assetType === 'audio' ? 'mp3' : 'jpg'
  const ext = blob.type.split('/')[1] || fallbackExt
  const mime = blob.type || (assetType === 'video' ? 'video/mp4' : assetType === 'audio' ? 'audio/mpeg' : 'image/jpeg')
  return new File([blob], `${baseName}.${ext}`, { type: mime })
}
