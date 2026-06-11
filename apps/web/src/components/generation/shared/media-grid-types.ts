/** 缩略图网格条目（通用，图片/视频/音频面板共用） */
export interface MediaGridItem {
  /** 唯一标识 */
  id: string
  /** 媒体类型 */
  kind: 'image' | 'video' | 'audio'
  /** 预览 URL（图片/视频用，音频可为空） */
  previewUrl: string
  /** 显示标签，如 "图片1"、"首帧图"、"视频1"、"音频1" */
  label: string
  /** 文件名（视频/音频用） */
  name?: string
  /** 时长秒数（视频/音频用） */
  duration?: number
}

/** 媒体预览状态（灯箱/全屏播放） */
export interface MediaPreviewState {
  /** 预览类型 */
  type: 'image' | 'video'
  /** 资源 URL */
  url: string
  /** 显示名称 */
  name: string
  /** 当前图片索引（用于导航） */
  index?: number
  /** 图片总数（用于导航） */
  total?: number
}
