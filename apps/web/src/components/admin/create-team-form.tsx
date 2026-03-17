'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { apiPost, ApiError } from '@/lib/api-client'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'

interface CreateTeamFormProps {
  onCreated: () => void
}

export function CreateTeamForm({ onCreated }: CreateTeamFormProps) {
  const [name, setName] = useState('')
  const [ownerEmail, setOwnerEmail] = useState('')
  const [ownerPassword, setOwnerPassword] = useState('')
  const [initialCredits, setInitialCredits] = useState('1000')
  const [teamType, setTeamType] = useState<'standard' | 'company_a'>('standard')
  const [loading, setLoading] = useState(false)

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!name || !ownerEmail) return

    setLoading(true)
    try {
      await apiPost('/admin/teams', {
        name,
        owner_email: ownerEmail,
        owner_password: ownerPassword || undefined,
        initial_credits: parseInt(initialCredits, 10) || 0,
        team_type: teamType,
      })
      toast.success('团队已创建')
      setName('')
      setOwnerEmail('')
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
            <Label>组长邮箱</Label>
            <Input type="email" value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)} required placeholder="owner@example.com" />
          </div>
          <div className="space-y-2">
            <Label>组长初始密码（可选）</Label>
            <Input type="password" value={ownerPassword} onChange={(e) => setOwnerPassword(e.target.value)} placeholder="留空则使用默认密码" />
          </div>
          <div className="space-y-2">
            <Label>初始积分</Label>
            <Input type="number" value={initialCredits} onChange={(e) => setInitialCredits(e.target.value)} placeholder="1000" />
          </div>
          <div className="space-y-2">
            <Label>团队类型</Label>
            <div className="flex gap-3">
              {(['standard', 'company_a'] as const).map((type) => (
                <label
                  key={type}
                  className={`flex items-center gap-2 px-3 py-2 rounded-md border cursor-pointer text-sm transition-colors ${
                    teamType === type ? 'border-primary bg-primary/5 text-primary' : 'border-border text-muted-foreground hover:border-primary/50'
                  }`}
                >
                  <input
                    type="radio"
                    name="team_type"
                    value={type}
                    checked={teamType === type}
                    onChange={() => setTeamType(type)}
                    className="sr-only"
                  />
                  {type === 'standard' ? '标准版' : '省台版'}
                </label>
              ))}
            </div>
          </div>
          <Button type="submit" disabled={loading || !name || !ownerEmail}>
            {loading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            创建团队
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
