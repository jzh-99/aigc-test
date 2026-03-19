function buildFilename(type?: 'image' | 'video'): string {
  const now = new Date()
  const ts =
    now.getFullYear().toString() +
    String(now.getMonth() + 1).padStart(2, '0') +
    String(now.getDate()).padStart(2, '0') +
    '-' +
    String(now.getHours()).padStart(2, '0') +
    String(now.getMinutes()).padStart(2, '0') +
    String(now.getSeconds()).padStart(2, '0')
  const ext = type === 'video' ? 'mp4' : 'jpg'
  return `aigc-${ts}.${ext}`
}

export function downloadAsset(url: string, type?: 'image' | 'video') {
  const filename = buildFilename(type)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}

// Backward-compatible alias
export const downloadImage = downloadAsset
