'use client'

import { useState, useEffect } from 'react'
import { Image as ImageIcon, Video, UserSquare2, Clapperboard } from 'lucide-react'
import { useGenerationStore } from '@/stores/generation-store'
import type { VideoParams } from '@/stores/generation-store'
import { useTeamFeatures } from '@/hooks/use-team-features'
import { useGenerationDefaults } from '@/hooks/use-generation-defaults'
import { cn } from '@/lib/utils'
import type { BatchResponse } from '@aigc/types'
import { ImagePanel } from './image/image-panel'
import { VideoPanel } from './video/video-panel'
import { AvatarPanel } from './avatar/avatar-panel'
import { ActionImitationPanel } from './action-imitation/action-imitation-panel'

type Mode = 'image' | 'video' | 'avatar' | 'action_imitation'

interface GenerationPanelProps {
  onBatchCreated: (batch: BatchResponse) => void
  disabled?: boolean
  initialMode?: Mode
}

export function GenerationPanel({ onBatchCreated, disabled, initialMode = 'image' }: GenerationPanelProps) {
  const { applyServerDefaults, videoParams, pendingModule, clearPendingModule, pendingVideoReferenceImages } = useGenerationStore()
  const { load: loadDefaults } = useGenerationDefaults()
  const { isCompanyA, showVideoTab, showAvatarTab, showActionImitationTab } = useTeamFeatures()

  const [mode, setMode] = useState<Mode>(initialMode)
  // key 变化时强制 VideoPanel/AvatarPanel 重新 mount，以便 initialParams 生效
  const [videoPanelKey, setVideoPanelKey] = useState(0)
  const [videoPanelInitialParams, setVideoPanelInitialParams] = useState<VideoParams | null>(null)
  const [avatarPanelKey, setAvatarPanelKey] = useState(0)

  // 加载服务端默认参数，写入 store（VideoPanel/AvatarPanel 从 store 读取初始值）
  useEffect(() => {
    loadDefaults().then((d) => {
      applyServerDefaults({
        userDefaults: d.image ? {
          modelType: (d.image.modelType as never) ?? 'gemini',
          resolution: (d.image.resolution as never) ?? '2k',
          aspectRatio: d.image.aspectRatio ?? '1:1',
          quantity: d.image.quantity ?? 1,
          watermark: d.image.watermark ?? false,
        } : null,
        videoDefaults: d.video ? {
          videoModel: d.video.videoModel ?? 'seedance-2.0',
          videoAspectRatio: d.video.videoAspectRatio ?? '',
          videoResolution: d.video.videoResolution ?? '',
          videoDuration: d.video.videoDuration ?? 5,
          videoGenerateAudio: d.video.videoGenerateAudio ?? true,
          videoCameraFixed: d.video.videoCameraFixed ?? false,
        } : null,
        avatarDefaults: d.avatar ? {
          avatarResolution: (d.avatar.avatarResolution as never) ?? '720p',
        } : null,
      })
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // 处理跨组件跳转（从历史记录/资产库触发）
  useEffect(() => {
    if (!pendingModule) return
    if (pendingModule === 'video') {
      // 有 pending 参考素材但没有 videoParams 时（来自"变视频"操作），不要重建面板，
      // 否则 VideoPanel 的 useEffect 刚将素材写入 multimodalImages 就被 key 变更销毁。
      // 复用视频会同时带 videoParams，需要重建面板来恢复模型、比例、时长等参数。
      if (pendingVideoReferenceImages.length === 0 || videoParams) {
        setVideoPanelInitialParams(videoParams ?? null)
        setVideoPanelKey(k => k + 1)
      }
      setMode('video')
    } else if (pendingModule === 'avatar') {
      setAvatarPanelKey(k => k + 1)
      setMode('avatar')
    } else if (pendingModule === 'action_imitation') {
      setMode('action_imitation')
    } else {
      setMode('image')
    }
    clearPendingModule()
  }, [pendingModule]) // eslint-disable-line react-hooks/exhaustive-deps

  // 当 tab 对应功能被禁用时，回退到图片模式
  useEffect(() => {
    if (mode === 'avatar' && !showAvatarTab) setMode('image')
    if (mode === 'action_imitation' && !showActionImitationTab) setMode('image')
  }, [mode, showAvatarTab, showActionImitationTab])

  const tabBtnCls = (active: boolean) => cn(
    'generation-dream-mode-tab flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium transition-all',
    active
      ? 'generation-dream-mode-tab-active'
      : 'generation-dream-mode-tab-idle'
  )

  return (
    <div className="flex flex-col gap-4 h-full">
      <div className="flex flex-col flex-1 min-h-0">
        {/* 书签标签（公司A只有图片模式，隐藏标签） */}
        {!isCompanyA && (
          <div className="generation-dream-mode-tabs flex items-center gap-1.5 rounded-full p-1.5">
            <button onClick={() => setMode('image')} className={tabBtnCls(mode === 'image')}>
              <ImageIcon className="h-3.5 w-3.5" />图片
            </button>
            {showVideoTab && (
              <button onClick={() => setMode('video')} className={tabBtnCls(mode === 'video')}>
                <Video className="h-3.5 w-3.5" />视频
              </button>
            )}
            {showAvatarTab && (
              <button onClick={() => setMode('avatar')} className={tabBtnCls(mode === 'avatar')}>
                <UserSquare2 className="h-3.5 w-3.5" />数字人
              </button>
            )}
            {showActionImitationTab && (
              <button onClick={() => setMode('action_imitation')} className={tabBtnCls(mode === 'action_imitation')}>
                <Clapperboard className="h-3.5 w-3.5" />动作模仿
              </button>
            )}
          </div>
        )}

        {/* 各模式面板 */}
        {mode === 'image' && (
          <ImagePanel onBatchCreated={onBatchCreated} disabled={disabled} isCompanyA={isCompanyA} />
        )}
        {mode === 'video' && (
          <VideoPanel key={videoPanelKey} onBatchCreated={onBatchCreated} disabled={disabled} initialParams={videoPanelInitialParams} />
        )}
        {mode === 'avatar' && (
          <AvatarPanel key={avatarPanelKey} onBatchCreated={onBatchCreated} disabled={disabled} />
        )}
        {mode === 'action_imitation' && (
          <ActionImitationPanel onBatchCreated={onBatchCreated} disabled={disabled} />
        )}
      </div>
    </div>
  )
}
