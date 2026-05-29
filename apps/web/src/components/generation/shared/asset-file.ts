import { resolveAssetFetchUrl } from './asset-url'

type AssetFetcher = (url: string, init?: RequestInit) => Promise<Response>

export async function fetchAssetFile(
  url: string,
  assetType: string,
  baseName: string,
  fetcher: AssetFetcher = fetch,
): Promise<File> {
  const resp = await fetcher(resolveAssetFetchUrl(url))
  if (!resp.ok) throw new Error('fetch failed')
  const blob = await resp.blob()
  const fallbackExt = assetType === 'video' ? 'mp4' : assetType === 'audio' ? 'mp3' : 'jpg'
  const ext = blob.type.split('/')[1] || fallbackExt
  const mime = blob.type || (assetType === 'video' ? 'video/mp4' : assetType === 'audio' ? 'audio/mpeg' : 'image/jpeg')
  return new File([blob], `${baseName}.${ext}`, { type: mime })
}
