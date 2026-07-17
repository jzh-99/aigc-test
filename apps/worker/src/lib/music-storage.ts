import { randomUUID } from 'node:crypto'
import { extname } from 'node:path'
import { validateExternalUrl } from './url-validator.js'
import { getBucket, getPublicUrl, getTos } from './storage.js'

const DEFAULT_MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024

const CONTENT_TYPE_EXTENSIONS: Record<string, string> = {
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/flac': 'flac',
  'audio/aac': 'aac',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
  'video/mp4': 'm4a',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

export interface DownloadedMusicFile {
  buffer: Buffer
  contentType: string
  extension: string
}

export interface StoredMusicFile extends DownloadedMusicFile {
  key: string
  storageUrl: string
}

export type MusicStorageKind = 'audio' | 'flac' | 'wav' | 'cover' | 'source-audio'

function normalizeContentType(value: string | null): string {
  return value?.split(';')[0]?.trim().toLowerCase() || 'application/octet-stream'
}

function extensionFromUrl(url: string): string | null {
  try {
    const pathname = new URL(url).pathname
    const ext = extname(pathname).replace('.', '').toLowerCase()
    return ext || null
  } catch {
    return null
  }
}

export function extensionForMusicContent(contentType: string, fallbackUrl?: string): string {
  const normalized = normalizeContentType(contentType)
  return CONTENT_TYPE_EXTENSIONS[normalized] ?? (fallbackUrl ? extensionFromUrl(fallbackUrl) : null) ?? 'bin'
}

export function buildMusicStorageKey(kind: MusicStorageKind, ownerId: string, extension: string): string {
  const safeExt = extension.replace(/[^a-z0-9]/gi, '').toLowerCase() || 'bin'
  return `music/${kind}/${ownerId}/${Date.now()}-${randomUUID()}.${safeExt}`
}

export function assertMusicContentType(contentType: string, kind: MusicStorageKind): void {
  const normalized = normalizeContentType(contentType)
  const valid = kind === 'cover' ? normalized.startsWith('image/') : normalized.startsWith('audio/') || normalized === 'video/mp4'
  if (!valid) throw new Error(`文件类型不支持: ${normalized}`)
}

export async function downloadMusicFile(
  url: string,
  kind: MusicStorageKind,
  options: { maxBytes?: number; fetchImpl?: typeof fetch } = {},
): Promise<DownloadedMusicFile> {
  validateExternalUrl(url)
  const fetchImpl = options.fetchImpl ?? fetch
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_DOWNLOAD_BYTES
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(60_000) })
  if (!res.ok) throw new Error(`下载音乐文件失败: ${res.status}`)

  const contentLength = Number(res.headers.get('content-length') ?? 0)
  if (contentLength > maxBytes) throw new Error(`音乐文件超过大小限制: ${contentLength}`)

  const contentType = normalizeContentType(res.headers.get('content-type'))
  assertMusicContentType(contentType, kind)

  const buffer = Buffer.from(await res.arrayBuffer())
  if (buffer.length === 0) throw new Error('音乐文件为空')
  if (buffer.length > maxBytes) throw new Error(`音乐文件超过大小限制: ${buffer.length}`)

  return {
    buffer,
    contentType,
    extension: extensionForMusicContent(contentType, url),
  }
}

export async function uploadMusicBuffer(
  kind: MusicStorageKind,
  ownerId: string,
  buffer: Buffer,
  contentType: string,
  extension = extensionForMusicContent(contentType),
): Promise<{ key: string; storageUrl: string }> {
  if (buffer.length === 0) throw new Error('上传文件不能为空')
  assertMusicContentType(contentType, kind)
  const key = buildMusicStorageKey(kind, ownerId, extension)
  await getTos().putObject({ bucket: getBucket(), key, body: buffer, contentType })
  return { key, storageUrl: `${getPublicUrl()}/${key}` }
}

export async function transferMusicUrl(
  url: string,
  kind: MusicStorageKind,
  ownerId: string,
  options: { maxBytes?: number; fetchImpl?: typeof fetch } = {},
): Promise<StoredMusicFile> {
  const downloaded = await downloadMusicFile(url, kind, options)
  const uploaded = await uploadMusicBuffer(kind, ownerId, downloaded.buffer, downloaded.contentType, downloaded.extension)
  return { ...downloaded, ...uploaded }
}

