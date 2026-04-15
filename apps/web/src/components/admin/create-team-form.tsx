'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { apiPost, ApiError } from '@/lib/api-client'
import { toast } from 'sonner'
import { Loader2, Info } from 'lucide-react'

interface CreateTeamFormProps {
  onCreated: () => void
}

export function CreateTeamForm({ onCreated }: CreateTeamFormProps) {
  const [name, setName] = useState('')
  const [ownerIdentifier, setOwnerIdentifier] = useState('')
  const [ownerPassword, setOwnerPassword] = useState('')
  const [initialCredits, setInitialCredits] = useState('1000')
  const [teamType, setTeamType] = useState<'standard' | 'company_a' | 'avatar_enabled'>('standard')
  const [loading, setLoading] = useState(false)
  const [phoneError, setPhoneError] = useState('')

  function handleIdentifierChange(val: string) {
    setOwnerIdentifier(val)
    const trimmed = val.trim()
    if (trimmed && !trimmed.includes('@')) {
      setPhoneError(/^\d{11}$/.test(trimmed) ? '' : '手机号必须是 11 位数字')
    } else {
      setPhoneError('')
    }
  }

  const isPhone = !ownerIdentifier.trim().includes('@')
  const isValid = !!name && !!ownerIdentifier.trim() && !phoneError

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!isValid) return

    setLoading(true)
    try {
      const trimmed = ownerIdentifier.trim()
      const isEmail = trimmed.includes('@')
      const res = await apiPost<{ owner: { account: string; username: string; existing: boolean } }>('/admin/teams', {
        name,
        ...(isEmail ? { owner_email: trimmed } : { owner_phone: trimmed }),
        owner_password: ownerPassword || undefined,
        initial_credits: parseInt(initialCredits, 10) || 0,
        team_type: teamType,
      })

      if (res.owner.existing) {
        toast.success(
          `团队已创建，组长为已有用户 ${res.owner.username}（${res.owner.account}）${ownerPassword ? '，密码已更新' : '，密码保持不变'}`,
          { duration: 6000 }
        )
      } else {
        toast.success(`团队已创建，新建组长账号 ${res.owner.account}`)
      }

      setName('')
      setOwnerIdentifier('')
      setOwnerPassword('')
      setInitialCredits('1000')
      setTeamType('standard')
      onCreated()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '创建失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card className="max-w-lg">
      <CardHeader>
        <CardTitle>创建新团队</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleCreate} className="space-y-4">
          <div className="space-y-2">
            <Label>团队名称</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} required placeholder="输入团队名称" />
          </div>
          <div className="space-y-2">
            <Label>负责人邮箱 / 手机号</Label>
            <Input
              type="text"
              value={ownerIdentifier}
              onChange={(e) => handleIdentifierChange(e.target.value)}
              required
              placeholder="owner@example.com 或 11 位手机号"
            />
            {phoneError && <p className="text-xs text-destructive">{phoneError}</p>}
          </div>
          <div className="space-y-2">
            <Label>
              {isPhone ? '组长密码（新用户必填，已有用户留空保持原密码）' : '组长初始密码（可选）'}
            </Label>
            <Input type="password" value={ownerPassword} onChange={(e) => setOwnerPassword(e.target.value)} placeholder={isPhone ? '新用户必填，已有用户可留空' : '留空则保持原密码不变'} />
            <p className="text-xs text-muted-foreground flex items-start gap-1">
              <Info className="h-3 w-3 mt-0.5 shrink-0" />
              若账号已存在，填写密码将更新其密码；留空则保持其原有密码不变
            </p>
          </div>
          <div className="space-y-2">
            <Label>初始积分</Label>
            <Input type="number" value={initialCredits} onChange={(e) => setInitialCredits(e.target.value)} placeholder="1000" />
          </div>
          <div className="space-y-2">
            <Label>团队类型</Label>
            <Select value={teamType} onValueChange={(v) => setTeamType(v as 'standard' | 'company_a' | 'avatar_enabled')}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="standard">标准版</SelectItem>
                <SelectItem value="company_a">省台版</SelectItem>
                <SelectItem value="avatar_enabled">专业版</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button type="submit" disabled={loading || !isValid}>
            {loading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            创建团队
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
