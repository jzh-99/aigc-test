/**
 * 校验导出 segments 是否满足导出条件
 */
export function validateShortDramaExportSegments(
  segments: Array<{ id: string; videoUrl?: string }>
): void {
  if (segments.length === 0) throw new Error('至少需要 1 个片段视频')
  for (const segment of segments) {
    if (!segment.videoUrl) throw new Error(`片段 ${segment.id} 缺少视频地址`)
  }
}

/**
 * 构建 ffmpeg concat demuxer 的 manifest 文件内容
 */
export function buildConcatManifest(paths: string[]): string {
  return paths.map(path => `file '${path.replace(/'/g, `'\\''`)}'`).join('\n')
}
