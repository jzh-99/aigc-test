'use client'

import { useState, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { apiPost, ApiError } from '@/lib/api-client'
import { useAuthStore } from '@/stores/auth-store'
import { toast } from 'sonner'
import { Loader2, Copy } from 'lucide-react'

interface InviteDialogProps {
  teamId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}

function generateDefaultWsName(existingNames: string[]): string {
  const nameSet = new Set(existingNames)
  for (let i = 1; i <= 99; i++) {
    const name = `工作区${String(i).padStart(2, '0')}`
    if (!nameSet.has(name)) return name
  }
  return `工作区${Date.now()}`
}

export function InviteDialog({
  teamId,
  open,
  onOpenChange,
  onSuccess,
}: InviteDialogProps) {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [inviteLink, setInviteLink] = useState<string | null>(null)

  const activeTeam = useAuthStore((s) => s.activeTeam())
  const workspaces = activeTeam?.workspaces ?? []

  const defaultWsName = useMemo(
    () => generateDefaultWsName(workspaces.map((w) => w.name)),
    [workspaces],
  )

  // Workspace selection — default to 'new'
  const [wsMode, setWsMode] = useState<'existing' | 'new'>('new')
  const [selectedWsId, setSelectedWsId] = useState<string>(workspaces[0]?.id ?? '')
  const [newWsName, setNewWsName] = useState(defaultWsName)

  async function handleInvite() {
    if (!email) return
    setLoading(true)
    try {
      const body: Record<string, string> = { email }
      if (wsMode === 'new' && newWsName.trim()) {
        body.new_workspace_name = newWsName.trim()
      } else if (wsMode === 'existing' && selectedWsId) {
        body.workspace_id = selectedWsId
      }

      const res = await apiPost<{ invite_token: string }>(
        `/teams/${teamId}/members`,
        body
      )
      const link = `${window.location.origin}/accept-invite?token=${res.invite_token}&email=${encodeURIComponent(email)}`
      setInviteLink(link)
      toast.success('邀请已发送')
      onSuccess()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '邀请失败，请稍后重试')
    } finally {
      setLoading(false)
    }
  }

  function handleCopy() {
    if (inviteLink) {
      navigator.clipboard.writeText(inviteLink)
      toast.success('链接已复制')
    }
  }

  function handleClose(nextOpen: boolean) {
    if (!nextOpen) {
      setEmail('')
      setInviteLink(null)
      setWsMode('new')
      setSelectedWsId(workspaces[0]?.id ?? '')
      setNewWsName(defaultWsName)
    }
    onOpenChange(nextOpen)
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>邀请成员</DialogTitle>
        </DialogHeader>
        {inviteLink ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              邀请链接已生成，请发送给被邀请人：
            </p>
            <div className="flex gap-2">
              <Input value={inviteLink} readOnly className="text-xs" />
              <Button size="icon" variant="outline" onClick={handleCopy}>
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>邮箱地址</Label>
              <Input
                type="email"
                placeholder="member@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <div className="space-y-3">
              <Label>加入工作区</Label>
              <RadioGroup
                value={wsMode}
                onValueChange={(v) => setWsMode(v as 'existing' | 'new')}
                className="space-y-2"
              >
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="new" id="ws-new" />
                  <Label htmlFor="ws-new" className="font-normal cursor-pointer">新建工作区</Label>
                </div>
                {wsMode === 'new' && (
                  <div className="ml-6">
                    <Input
                      value={newWsName}
                      onChange={(e) => setNewWsName(e.target.value)}
                      placeholder="输入工作区名称"
                    />
                  </div>
                )}

                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="existing" id="ws-existing" disabled={workspaces.length === 0} />
                  <Label
                    htmlFor="ws-existing"
                    className={`font-normal cursor-pointer ${workspaces.length === 0 ? 'text-muted-foreground' : ''}`}
                  >
                    加入现有工作区
                    {workspaces.length === 0 && <span className="text-xs ml-1">(暂无)</span>}
                  </Label>
                </div>
                {wsMode === 'existing' && workspaces.length > 0 && (
                  <div className="ml-6">
                    <Select value={selectedWsId} onValueChange={setSelectedWsId}>
                      <SelectTrigger>
                        <SelectValue placeholder="选择工作区" />
                      </SelectTrigger>
                      <SelectContent>
                        {workspaces.map((ws) => (
                          <SelectItem key={ws.id} value={ws.id}>
                            {ws.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </RadioGroup>
            </div>
          </div>
        )}
        <DialogFooter>
          {inviteLink ? (
            <Button onClick={() => handleClose(false)}>完成</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={() => handleClose(false)}>
                取消
              </Button>
              <Button
                onClick={handleInvite}
                disabled={
                  loading || !email ||
                  (wsMode === 'new' && !newWsName.trim()) ||
                  (wsMode === 'existing' && !selectedWsId)
                }
              >
                {loading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                发送邀请
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
