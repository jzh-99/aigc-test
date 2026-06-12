import { Inter, Syne, Noto_Sans_SC } from 'next/font/google'
import { Toaster } from 'sonner'
import { ConfirmProvider } from '@/hooks/use-confirm'
import { ProgressBar } from '@/components/layout/progress-bar'
import './globals.css'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
})

const syne = Syne({
  subsets: ['latin'],
  variable: '--font-syne',
  weight: ['600', '700', '800'],
})

// 构建时自动下载并自托管，运行时零 Google 网络请求
const notoSansSC = Noto_Sans_SC({
  subsets: ['latin'],
  variable: '--font-noto-sans-sc',
  weight: ['400', '500', '600', '700'],
  display: 'swap',
  preload: false, // 中文字体体积大，不预加载，按需加载即可
})

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
      <body
        className={`${inter.variable} ${syne.variable} ${notoSansSC.variable} font-sans antialiased`}
        style={{ fontFamily: 'var(--font-inter), var(--font-noto-sans-sc), sans-serif' }}
      >
        <ProgressBar />
        <ConfirmProvider>
          {children}
        </ConfirmProvider>
        <Toaster position="top-center" richColors duration={4000} />
      </body>
    </html>
  )
}
