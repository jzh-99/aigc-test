'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { UploadCloud } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { createMusicVoiceClone } from '@/lib/music/api'
import type { MusicVoiceCloneResponse } from '@aigc/types'

const VOICE_CLONE_AUDIO_MAX_SIZE = 10 * 1024 * 1024
const VOICE_CLONE_AUDIO_EXTS = ['mp3', 'm4a'] as const

interface Props {
  open: boolean
  workspaceId: string
  onOpenChange: (open: boolean) => void
  onCreated: (voiceClone: MusicVoiceCloneResponse) => void
}

export function MusicVoiceUploadDialog({ open, workspaceId, onOpenChange, onCreated }: Props) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const descriptionTooLong = [...description].length > 1024
  const fileHint = '仅支持 MP3 / M4A，10MB 以内，至少 15 秒有效人声'

  function selectFile(nextFile: File | null) {
    if (!nextFile) {
      setFile(null)
      return
    }

    const ext = nextFile.name.split('.').pop()?.toLowerCase()
    if (!VOICE_CLONE_AUDIO_EXTS.includes(ext as (typeof VOICE_CLONE_AUDIO_EXTS)[number])) {
      toast.error('音频只支持 MP3 或 M4A 格式')
      setFile(null)
      return
    }

    if (nextFile.size > VOICE_CLONE_AUDIO_MAX_SIZE) {
      toast.error('音频文件需在 10MB 以内')
      setFile(null)
      return
    }

    setFile(nextFile)
  }

  async function submit() {
    if (!name.trim() || !file || descriptionTooLong || submitting) return
    setSubmitting(true)
    try {
      const form = new FormData()
      form.set('workspace_id', workspaceId)
      form.set('name', name.trim())
      form.set('description', description.trim())
      form.set('gender', 'auto')
      form.set('file', file)
      const voiceClone = await createMusicVoiceClone(form)
      toast.success('音色克隆任务已提交')
      onCreated(voiceClone)
      onOpenChange(false)
      setName('')
      setDescription('')
      setFile(null)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '音色克隆提交失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>上传自己的音频生成音色</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="voice-name">音色名称</Label>
            <Input
              id="voice-name"
              value={name}
              maxLength={40}
              className="bg-background/45 border-primary/20 focus-visible:ring-primary/40"
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="voice-file">音频文件</Label>
            <label
              htmlFor="voice-file"
              className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed border-primary/30 bg-primary/12 px-4 py-4 text-sm transition-colors hover:border-primary/55 hover:bg-primary/20"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
                <UploadCloud className="h-5 w-5" />
              </span>
              <span className="min-w-0">
                <span className="block font-medium text-foreground">{file ? file.name : '选择音频文件'}</span>
                <span className="mt-1 block truncate text-xs text-muted-foreground">{fileHint}</span>
              </span>
            </label>
            <Input
              id="voice-file"
              type="file"
              accept=".mp3,audio/mpeg,audio/mp3,.m4a,audio/mp4,audio/x-m4a"
              className="sr-only"
              onChange={(event) => {
                selectFile(event.target.files?.[0] ?? null)
                event.currentTarget.value = ''
              }}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="voice-description">描述</Label>
            <Textarea
              id="voice-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="可选，1024 字以内"
              className="bg-background/45 border-primary/20 placeholder:text-muted-foreground/55 focus-visible:ring-primary/40"
              rows={4}
            />
            <div className={descriptionTooLong ? 'text-xs text-destructive text-right' : 'text-xs text-muted-foreground text-right'}>
              {[...description].length} / 1024
            </div>
          </div>
          <Button className="w-full" disabled={!name.trim() || !file || descriptionTooLong || submitting} onClick={submit}>
            {submitting ? '提交中...' : '提交音色克隆'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
