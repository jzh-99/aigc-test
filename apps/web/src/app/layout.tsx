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
    <html lang="zh" suppressHydrationWarning>
      <head>
        {/* 防止暗黑主题闪烁（FOUC） */}
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
