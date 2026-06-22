import { Toaster } from 'sonner'
import { ConfirmProvider } from '@/hooks/use-confirm'
import { ProgressBar } from '@/components/layout/progress-bar'
import './globals.css'

export const metadata = {
  title: 'AIGC 创作平台',
  description: 'AI-powered content generation platform',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh" className="dark" suppressHydrationWarning>
      <head>
        {/* 内联脚本保留：用于客户端确认 dark class 存在（与 SSR 一致，幂等），
            同时兼容未来可能的「跟随系统主题」切换。SSR 已直接输出 class="dark"，
            避免了「SSR 无 dark class / 客户端有 dark class」造成的 hydration mismatch。 */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){document.documentElement.classList.add('dark')})()`,
          }}
        />
      </head>
      <body className="font-sans antialiased">
        <ProgressBar />
        <ConfirmProvider>
          {children}
        </ConfirmProvider>
        <Toaster position="top-center" richColors duration={4000} />
      </body>
    </html>
  )
}
