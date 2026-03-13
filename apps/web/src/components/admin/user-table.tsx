'use client'

import useSWR from 'swr'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'

interface User {
  id: string
  email: string
  username: string
  role: string
  status: string
  created_at: string
  credit_used: number
  credit_quota: number | null
  lifetime_used: number
  teams: string[]
}

export function UserTable() {
  const { data, error } = useSWR<{ data: User[] }>('/admin/users')

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
    <Card>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-muted-foreground">
                <th className="text-left py-3 px-4 font-medium">用户名</th>
                <th className="text-left py-3 px-4 font-medium">邮箱</th>
                <th className="text-left py-3 px-4 font-medium">角色</th>
                <th className="text-left py-3 px-4 font-medium">状态</th>
                <th className="text-left py-3 px-4 font-medium">所属团队</th>
                <th className="text-right py-3 px-4 font-medium">本期已用</th>
                <th className="text-right py-3 px-4 font-medium">累计已用</th>
                <th className="text-right py-3 px-4 font-medium">积分配额</th>
                <th className="text-left py-3 px-4 font-medium">注册时间</th>
              </tr>
            </thead>
            <tbody>
              {data?.data.map((user) => (
                <tr key={user.id} className="border-b last:border-0">
                  <td className="py-3 px-4 font-medium">{user.username}</td>
                  <td className="py-3 px-4 text-muted-foreground">{user.email}</td>
                  <td className="py-3 px-4">
                    <Badge variant={user.role === 'admin' ? 'default' : 'outline'}>
                      {user.role === 'admin' ? '管理员' : '成员'}
                    </Badge>
                  </td>
                  <td className="py-3 px-4">
                    <Badge variant={user.status === 'active' ? 'outline' : 'destructive'}>
                      {user.status === 'active' ? '正常' : user.status === 'suspended' ? '待激活' : '已禁用'}
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}
