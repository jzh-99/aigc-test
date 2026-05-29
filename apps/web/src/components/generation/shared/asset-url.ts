const STORAGE_PROXY_HOSTS = ['.volces.com', '.volccdn.com']

export function resolveAssetFetchUrl(url: string, origin = globalThis.location?.origin): string {
  const isSameOrigin = url.startsWith('/') || (origin ? url.startsWith(origin) : false)
  if (isSameOrigin) return url

  try {
    const parsed = new URL(url)
    if (STORAGE_PROXY_HOSTS.some((host) => parsed.hostname.includes(host))) {
      const key = parsed.pathname.replace(/^\//, '')
      if (key) return `/api/v1/assets/fetch?key=${encodeURIComponent(key)}`
    }
  } catch {
    return url
  }

  return url
}
