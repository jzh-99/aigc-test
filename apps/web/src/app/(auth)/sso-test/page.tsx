'use client'

import { useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Loader2 } from 'lucide-react'

export default function SsoTestPage() {
  const [secret, setSecret] = useState('')
  const [userId, setUserId] = useState('')
  const [account, setAccount] = useState('')
  const [targetOrigin, setTargetOrigin] = useState('')
  const [redirect, setRedirect] = useState('/')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [generatedToken, setGeneratedToken] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setGeneratedToken('')
    setLoading(true)

    try {
      const res = await fetch('/api/sso-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret, userId, account }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? '签发失败')
        return
      }

      setGeneratedToken(data.token)

      const safePath = redirect.startsWith('/') && !redirect.startsWith('//') ? redirect : '/'
      // Determine target: use provided origin or fall back to current origin
      let origin = targetOrigin.trim().replace(/\/$/, '')
      if (!origin) {
        origin = window.location.origin
      } else if (!/^https?:\/\//i.test(origin)) {
        origin = 'https://' + origin
      }

      const url = `${origin}/login?token=${data.token}&redirect=${encodeURIComponent(safePath)}`
      window.location.href = url
    } catch {
      setError('请求失败，请检查网络')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card className="border-border shadow-xl">
      <CardContent className="pt-8 pb-6 px-8">
        <div className="text-center mb-6">
          <h2 className="text-xl font-bold">SSO 跳转测试</h2>
          <p className="text-sm text-muted-foreground mt-1">模拟对方系统签发 Token 并跳转</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label>JWT_SECRET</Label>
            <Input
              type="password"
              placeholder="输入共享密钥"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label>User ID（sub）</Label>
            <Input
              placeholder="目标服务器 users.id，UUID 格式"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label>Account</Label>
            <Input
              placeholder="目标服务器 users.account，邮箱或手机号"
              value={account}
              onChange={(e) => setAccount(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label>目标服务器域名</Label>
            <Input
              placeholder="不填则跳转当前服务器，例：https://example.com:8443"
              value={targetOrigin}
              onChange={(e) => setTargetOrigin(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>跳转路径</Label>
            <Input
              placeholder="/"
              value={redirect}
              onChange={(e) => setRedirect(e.target.value)}
            />
          </div>

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}

          {generatedToken && (
            <div className="rounded bg-muted px-3 py-2 text-xs font-mono break-all text-muted-foreground">
              {generatedToken}
            </div>
          )}

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />生成中...</> : '生成 Token 并跳转'}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
