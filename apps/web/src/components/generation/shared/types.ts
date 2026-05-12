export interface FrameImage {
  id?: string
  previewUrl: string
  dataUrl: string
  file?: File
}

export type MediaPreview =
  | { type: 'image'; url: string; name: string; index: number; total: number }
  | { type: 'video'; url: string; name: string }
  | { type: 'audio'; url: string; name: string; duration: number }
