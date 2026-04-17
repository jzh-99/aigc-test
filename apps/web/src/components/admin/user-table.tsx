'use client'

import { useState } from 'react'
import useSWR, { mutate } from 'swr'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Search, KeyRound, Zap, Stethoscope, Copy } from 'lucide-react'
import { AdminPasswordDialog } from './admin-password-dialog'
import { UserDiagnosisSheet } from './user-diagnosis-sheet'
import { apiPatch, ApiError } from '@/lib/api-client'
import { toast } from 'sonner'

interface User {
  id: string
  account: string
  username: string
  role: string
  status: string
  created_at: string
  credit_used: number
  credit_quota: number | null
  lifetime_used: number
  teams: string[]
  team_id: string | null
  priority_boost: boolean
}

export function UserTable() {
  const { data, error } = useSWR<{ data: User[] }>('/admin/users')
  const [search, setSearch] = useState('')
  const [passwordUserId, setPasswordUserId] = useState<string | null>(null)
  const [diagnosisUser, setDiagnosisUser] = useState<{ id: string; username: string } | null>(null)
  const [togglingId, setTogglingId] = useState<string | null>(null)

  const filtered = data?.data.filter(u =>
    u.account.toLowerCase().includes(search.toLowerCase()) ||
    u.username.toLowerCase().includes(search.toLowerCase())
  ) ?? []

  async function handleTogglePriority(user: User) {
    if (!user.team_id) {
      toast.error('该用户没有所属团队，无法设置优先级')
      return
    }
    setTogglingId(user.id)
    try {
      await apiPatch(`/teams/${user.team_id}/members/${user.id}`, { priority_boost: !user.priority_boost })
      toast.success(user.priority_boost ? '已取消优先特权' : '已开启优先特权')
      mutate('/admin/users')
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '操作失败')
    } finally {
      setTogglingId(null)
    }
  }

  if (!data && !error) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <>
      <div className="mb-3 flex justify-end">
        <div className="relative max-w-xs w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="按账户或用户名搜索..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th className="text-left py-3 px-4 font-medium">用户名</th>
                  <th className="text-left py-3 px-4 font-medium">账户</th>
                  <th className="text-left py-3 px-4 font-medium">User ID</th>
                  <th className="text-left py-3 px-4 font-medium">角色</th>
                  <th className="text-left py-3 px-4 font-medium">状态</th>
                  <th className="text-left py-3 px-4 font-medium">所属团队</th>
                  <th className="text-right py-3 px-4 font-medium">本期已用</th>
                  <th className="text-right py-3 px-4 font-medium">累计已用</th>
                  <th className="text-right py-3 px-4 font-medium">积分配额</th>
                  <th className="text-left py-3 px-4 font-medium">注册时间</th>
                  <th className="text-left py-3 px-4 font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((user) => (
                  <tr key={user.id} className="border-b last:border-0">
                    <td className="py-3 px-4 font-medium">{user.username}</td>
                    <td className="py-3 px-4 text-muted-foreground">{user.account}</td>
                    <td className="py-3 px-4">
                      <button
                        className="flex items-center gap-1 font-mono text-xs text-muted-foreground hover:text-foreground transition-colors group"
                        title={user.id}
                        onClick={() => {
                          navigator.clipboard.writeText(user.id)
                          toast.success('已复制 User ID')
                        }}
                      >
                        <span>{user.id.slice(0, 8)}…</span>
                        <Copy className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                      </button>
                    </td>
                    <td className="py-3 px-4">
                      <Badge variant={user.role === 'admin' ? 'default' : 'outline'}>
                        {user.role === 'admin' ? '管理员' : '成员'}
                      </Badge>
                    </td>
                    <td className="py-3 px-4">
                      <Badge variant={user.status === 'active' ? 'outline' : 'destructive'}>
                        {user.status === 'active' ? '正常' : user.status === 'suspended' && user.teams.length === 0 ? '无团队' : user.status === 'suspended' ? '待激活' : '已禁用'}
                      </Badge>
                    </td>
                    <td className="py-3 px-4">
                      {user.teams.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {user.teams.map((t, i) => (
                            <Badge key={i} variant="outline" className="text-[10px]">{t}</Badge>
                          ))}
                        </div>
                      ) : (
                        <span className="text-muted-foreground text-xs">无</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right">{user.credit_used.toLocaleString()}</td>
                    <td className="py-3 px-4 text-right font-medium">{user.lifetime_used.toLocaleString()}</td>
                    <td className="py-3 px-4 text-right text-muted-foreground">
                      {user.credit_quota !== null ? user.credit_quota.toLocaleString() : '无限'}
                    </td>
                    <td className="py-3 px-4 text-muted-foreground">
                      {new Date(user.created_at).toLocaleDateString('zh-CN')}
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-xs"
                          onClick={() => setDiagnosisUser({ id: user.id, username: user.username })}
                          title="用户诊断"
                        >
                          <Stethoscope className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-xs"
                          onClick={() => setPasswordUserId(user.id)}
                          title="修改密码"
                        >
                          <KeyRound className="h-3.5 w-3.5" />
                        </Button>
                        {user.role !== 'admin' && (
                          <Button
                            size="sm"
                            variant={user.priority_boost ? 'default' : 'ghost'}
                            className="h-7 px-2 text-xs"
                            onClick={() => handleTogglePriority(user)}
                            disabled={togglingId === user.id}
                            title={user.priority_boost ? '取消优先特权' : '开启优先特权'}
                          >
                            <Zap className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={11} className="py-8 text-center text-muted-foreground text-sm">
                      {search ? '没有找到匹配的用户' : '暂无用户'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <AdminPasswordDialog
        userId={passwordUserId}
        open={!!passwordUserId}
        onOpenChange={(open) => { if (!open) setPasswordUserId(null) }}
      />

      <UserDiagnosisSheet
        userId={diagnosisUser?.id ?? null}
        username={diagnosisUser?.username ?? ''}
        open={!!diagnosisUser}
        onOpenChange={(open) => { if (!open) setDiagnosisUser(null) }}
      />
    </>
  )
}
