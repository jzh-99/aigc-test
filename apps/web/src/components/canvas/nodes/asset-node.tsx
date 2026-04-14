'use client'

import { memo, useRef, useState } from 'react'
import { Handle, Position } from 'reactflow'
import { useCanvasStructureStore } from '@/stores/canvas/structure-store'
import { useNodeHighlighted } from '@/stores/canvas/execution-store'
import { useAuthStore } from '@/stores/auth-store'
import { uploadAssetFile } from '@/lib/canvas/canvas-api'
import { Image as ImageIcon, X, FileVideo, Music, Upload, Play, Pause, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import type { CanvasNodeData } from '@/lib/canvas/types'
import { InlineLabel } from './inline-label'

export interface AssetNodeConfig {
  url: string
  name?: string
  mimeType?: string
}

export const AssetNode = memo(function AssetNode({ id, data }: { id: string; data: CanvasNodeData<AssetNodeConfig> }) {
  const removeNodes = useCanvasStructureStore((s) => s.removeNodes)
  const updateNodeData = useCanvasStructureStore((s) => s.updateNodeData)
  const token = useAuthStore((s) => s.accessToken)
  const cfg = data.config as AssetNodeConfig
  const isVideo = cfg.mimeType?.startsWith('video')
  const isAudio = cfg.mimeType?.startsWith('audio')
  const isImage = !isVideo && !isAudio
  const isUpstream = useNodeHighlighted(id)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [playing, setPlaying] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!token) { toast.error('请先登录'); return }
    setUploading(true)
    try {
      const url = await uploadAssetFile(file, token)
      updateNodeData(id, {
        config: { url, name: file.name, mimeType: file.type },
        label: file.name.replace(/\.[^.]+$/, ''),
      })
    } catch (err: any) {
      toast.error(`上传失败: ${err.message}`)
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  function handleClickUpload(e: React.MouseEvent) {
    e.stopPropagation()
    fileInputRef.current?.click()
  }

  function togglePlay(e: React.MouseEvent) {
    e.stopPropagation()
    if (isVideo && videoRef.current) {
      if (playing) { videoRef.current.pause(); setPlaying(false) }
      else { videoRef.current.play(); setPlaying(true) }
    } else if (isAudio && audioRef.current) {
      if (playing) { audioRef.current.pause(); setPlaying(false) }
      else { audioRef.current.play(); setPlaying(true) }
    }
  }

  const TypeIcon = isVideo ? FileVideo : isAudio ? Music : ImageIcon

  return (
    <div
      className={cn(
        'group relative flex flex-col rounded-xl shadow-md border transition-all duration-200',
        'bg-white border-zinc-200 hover:border-zinc-300 hover:shadow-lg',
        isUpstream && 'border-violet-400 ring-1 ring-violet-300 shadow-violet-100',
        '[transform:translateZ(0)] [backface-visibility:hidden]',
      )}
      style={{ width: 160 }}
    >
      {/* Delete */}
      <button
        onClick={(e) => { e.stopPropagation(); removeNodes([id]) }}
        className="absolute -top-2.5 -right-2.5 z-50 p-1 rounded-full shadow border opacity-0 group-hover:opacity-100 transition-opacity scale-90 hover:scale-100 bg-white text-zinc-400 hover:text-red-500 border-zinc-200"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <X size={11} />
      </button>

      {/* Header */}
      <div className="px-3 py-1.5 border-b border-zinc-100 rounded-t-xl bg-zinc-50 flex items-center gap-1.5">
        <TypeIcon className="w-3 h-3 text-zinc-400 shrink-0" />
        <InlineLabel nodeId={id} label={data.label} onRename={(nid, val) => updateNodeData(nid, { label: val })} className="text-[11px] font-semibold tracking-wide text-zinc-500 uppercase truncate cursor-text select-none" />
      </div>

      {/* Preview / Upload area */}
      <div className="p-2 bg-white rounded-b-xl">
        {uploading ? (
          <div className="flex flex-col items-center justify-center gap-2 rounded-lg bg-zinc-50" style={{ aspectRatio: '4/3' }}>
            <Loader2 className="w-5 h-5 text-zinc-400 animate-spin" />
            <span className="text-[10px] text-zinc-400">上传中…</span>
          </div>
        ) : cfg.url ? (
          isAudio ? (
            <div className="flex flex-col gap-1">
              <div
                className="flex items-center justify-center gap-2 rounded-lg bg-zinc-50 cursor-pointer hover:bg-zinc-100 transition-colors"
                style={{ aspectRatio: '4/3' }}
                onClick={togglePlay}
                onMouseDown={(e) => e.stopPropagation()}
              >
                <div className="w-10 h-10 rounded-full bg-white border border-zinc-200 shadow flex items-center justify-center">
                  {playing ? <Pause className="w-4 h-4 text-zinc-700" /> : <Play className="w-4 h-4 text-zinc-700 ml-0.5" />}
                </div>
                <Music className="w-5 h-5 text-zinc-300" />
              </div>
              <audio
                ref={audioRef}
                src={cfg.url}
                onEnded={() => setPlaying(false)}
                className="hidden"
              />
            </div>
          ) : isVideo ? (
            <div className="relative rounded-lg overflow-hidden bg-black" style={{ aspectRatio: '16/9' }}>
              <video
                ref={videoRef}
                src={cfg.url}
                className="w-full h-full object-contain"
                muted
                preload="metadata"
                onEnded={() => setPlaying(false)}
              />
              <button
                onClick={togglePlay}
                onMouseDown={(e) => e.stopPropagation()}
                className="absolute inset-0 flex items-center justify-center bg-black/30 hover:bg-black/40 transition-colors"
              >
                <div className="w-8 h-8 rounded-full bg-white/90 flex items-center justify-center shadow">
                  {playing ? <Pause className="w-4 h-4 text-zinc-800" /> : <Play className="w-4 h-4 text-zinc-800 ml-0.5" />}
                </div>
              </button>
            </div>
          ) : (
            <img
              src={cfg.url}
              alt={cfg.name ?? 'asset'}
              className="w-full h-auto rounded-lg block"
              loading="lazy"
            />
          )
        ) : (
          <button
            onClick={handleClickUpload}
            onMouseDown={(e) => e.stopPropagation()}
            className="w-full flex flex-col items-center justify-center gap-2 rounded-lg bg-zinc-50 hover:bg-zinc-100 border-2 border-dashed border-zinc-200 hover:border-zinc-300 transition-colors cursor-pointer"
            style={{ aspectRatio: '4/3' }}
          >
            <Upload className="w-5 h-5 text-zinc-300" />
            <span className="text-[10px] text-zinc-400">点击上传</span>
            <span className="text-[9px] text-zinc-300">图片 / 视频 / 音频</span>
          </button>
        )}

        {cfg.url && (
          <button
            onClick={handleClickUpload}
            onMouseDown={(e) => e.stopPropagation()}
            className="mt-1 w-full text-[10px] text-zinc-400 hover:text-zinc-600 text-center transition-colors opacity-0 group-hover:opacity-100"
          >
            重新上传
          </button>
        )}

        {cfg.name && cfg.url && (
          <p className="mt-0.5 text-[10px] text-zinc-400 truncate text-center">{cfg.name}</p>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,video/*,audio/*"
        className="hidden"
        onChange={handleFileChange}
      />

      {/* Output handle — image connects to image_gen/video_gen; video/audio only to video_gen multiref */}
      <Handle
        type="source"
        position={Position.Right}
        id="image-out"
        className="!w-3.5 !h-3.5 !bg-zinc-200 !border !border-zinc-400 !-right-1.5 !rounded-full opacity-0 group-hover:opacity-100 hover:!bg-zinc-600 hover:!border-zinc-500 transition-all"
      />
    </div>
  )
})
AssetNode.displayName = 'AssetNode'
