import { Inter, Syne } from 'next/font/google'
import { Toaster } from 'sonner'
import { ThemeProvider } from '@/context/theme-provider'
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

export const metadata = {
  title: 'AIGC 创作平台',
  description: 'AI-powered content generation platform',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh" suppressHydrationWarning>
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
        {/* 防止暗黑主题闪烁（FOUC） */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){var t=localStorage.getItem('theme');if(t==='light'){document.documentElement.classList.remove('dark')}else{document.documentElement.classList.add('dark')}})()`,
          }}
        />
      </head>
      <body
        className={`${inter.variable} ${syne.variable} font-sans antialiased`}
        style={{ fontFamily: 'var(--font-inter), "Noto Sans SC", sans-serif' }}
      >
        <ThemeProvider>
          {children}
        </ThemeProvider>
        <Toaster position="top-center" richColors duration={4000} />
      </body>
    </html>
  )
}
