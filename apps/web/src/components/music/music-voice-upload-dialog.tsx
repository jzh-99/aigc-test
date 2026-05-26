'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { createMusicVoiceClone } from '@/lib/music/api'

interface Props {
  open: boolean
  workspaceId: string
  onOpenChange: (open: boolean) => void
  onCreated: () => void
}

export function MusicVoiceUploadDialog({ open, workspaceId, onOpenChange, onCreated }: Props) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const descriptionTooLong = [...description].length > 1024

  async function submit() {
    if (!name.trim() || !file || descriptionTooLong || submitting) return
    setSubmitting(true)
    try {
      const form = new FormData()
      form.set('workspace_id', workspaceId)
      form.set('name', name.trim())
      form.set('description', description.trim())
      form.set('model', 'mureka-8')
      form.set('gender', 'auto')
      form.set('file', file)
      await createMusicVoiceClone(form)
      toast.success('音色克隆任务已提交')
      onCreated()
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
            <Input id="voice-name" value={name} maxLength={40} onChange={(event) => setName(event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="voice-file">音频文件</Label>
            <Input id="voice-file" type="file" accept="audio/*,.mp3,.wav,.flac,.m4a,.aac,.ogg" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="voice-description">描述</Label>
            <Textarea
              id="voice-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="可选，1024 字以内"
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

