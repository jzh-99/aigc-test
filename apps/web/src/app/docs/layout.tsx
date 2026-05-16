'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Sun, Moon } from 'lucide-react'
import { useTheme } from '@/context/theme-provider'

const navSections = [
  {
    label: '开始使用',
    items: [
      { href: '/docs', label: '平台简介' },
      { href: '/docs/login', label: '登录与账户' },
      { href: '/docs/workspace', label: '工作台' },
    ],
  },
  {
    label: '核心功能',
    items: [
      { href: '/docs/image-generation', label: '图片生成' },
      { href: '/docs/video-generation', label: '视频生成' },
      { href: '/docs/asset-library', label: '资产库' },
      { href: '/docs/ai-assistant', label: 'AI 助手' },
    ],
  },
  {
    label: '实战样例',
    items: [
      { href: '/docs/case-poster', label: '海报制作' },
      { href: '/docs/case-video', label: '宣传短片' },
    ],
  },
]

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { theme, toggleTheme } = useTheme()

  return (
    <div className="docs-layout">
      {/* Sidebar */}
      <aside className="docs-sidebar">
        {/* Logo */}
        <div className="docs-sidebar-logo">
          <Link href="/" className="flex items-center gap-3 group">
            <div className="docs-logo-mark">
              <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect x="2" y="2.5" width="16" height="4" rx="1.5" fill="white" />
                <rect x="7.5" y="6" width="5" height="11.5" rx="1.5" fill="white" />
                <circle cx="17" cy="15.5" r="1.5" fill="rgba(255,255,255,0.75)" />
              </svg>
            </div>
            <div>
              <div className="docs-logo-name">Toby.AI 企业版</div>
              <div className="docs-logo-sub">AIGC 创作平台</div>
            </div>
          </Link>
        </div>

        {/* Nav */}
        <nav className="docs-nav">
          {navSections.map((section) => (
            <div key={section.label}>
              <div className="docs-nav-section-label">{section.label}</div>
              <ul className="space-y-0.5">
                {section.items.map((item) => {
                  const active = pathname === item.href
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        className={`docs-nav-item${active ? ' docs-nav-item--active' : ''}`}
                      >
                        {item.label}
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </nav>

        {/* Footer */}
        <div className="docs-sidebar-footer">
          <div className="flex items-center justify-between">
            <Link href="/" className="docs-back-link">
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              返回创作平台
            </Link>
            <button
              onClick={toggleTheme}
              className="docs-theme-toggle"
              aria-label={theme === 'dark' ? '切换到亮色' : '切换到暗色'}
            >
              {theme === 'dark' ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="docs-main">
        <div className="docs-main-inner">
          <article className="docs-content">
            {children}
          </article>
        </div>
      </main>
    </div>
  )
}
