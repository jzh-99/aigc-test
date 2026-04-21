'use client'

import { useEffect, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { CheckCircle2, XCircle, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

// Life platform redirects here after payment with result params
export default function PaymentCallbackPage() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const [status, setStatus] = useState<'loading' | 'success' | 'fail'>('loading')

  useEffect(() => {
    // Life platform passes payStatus or status in query params
    const payStatus = searchParams.get('payStatus') ?? searchParams.get('status') ?? ''
    if (payStatus === '1' || payStatus === 'success' || payStatus === '0') {
      setStatus('success')
    } else if (payStatus === '') {
      // No status param yet — wait briefly then check
      const t = setTimeout(() => setStatus('success'), 1500)
      return () => clearTimeout(t)
    } else {
      setStatus('fail')
    }
  }, [searchParams])

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-4 text-center p-8">
        {status === 'loading' && (
          <>
            <Loader2 className="h-12 w-12 animate-spin text-muted-foreground" />
            <p className="text-muted-foreground">正在确认支付结果...</p>
          </>
        )}
        {status === 'success' && (
          <>
            <CheckCircle2 className="h-12 w-12 text-green-500" />
            <h1 className="text-xl font-semibold">支付成功</h1>
            <p className="text-muted-foreground text-sm">积分将在几秒内到账</p>
            <Button onClick={() => router.push('/')}>返回首页</Button>
          </>
        )}
        {status === 'fail' && (
          <>
            <XCircle className="h-12 w-12 text-destructive" />
            <h1 className="text-xl font-semibold">支付未完成</h1>
            <p className="text-muted-foreground text-sm">如有疑问请联系客服</p>
            <Button variant="outline" onClick={() => router.push('/')}>返回首页</Button>
          </>
        )}
      </div>
    </div>
  )
}
