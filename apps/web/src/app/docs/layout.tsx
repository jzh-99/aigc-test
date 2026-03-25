'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

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

  return (
    <div className="min-h-screen flex" style={{ background: '#FAFAFA', fontFamily: "'Inter', 'PingFang SC', 'Helvetica Neue', sans-serif" }}>

      {/* Sidebar */}
      <aside className="w-72 shrink-0 flex flex-col sticky top-0 h-screen overflow-y-auto" style={{ background: '#FFFFFF', borderRight: '1px solid #EDE5F5' }}>

        {/* Logo */}
        <div className="px-6 py-6" style={{ borderBottom: '1px solid #EDE5F5' }}>
          <Link href="/docs" className="flex items-center gap-3 group">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl shrink-0 shadow-sm" style={{ background: 'linear-gradient(135deg, #F5A962, #C89BEC, #6BA3F5)' }}>
              <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect x="2" y="2.5" width="16" height="4" rx="1.5" fill="white"/>
                <rect x="7.5" y="6" width="5" height="11.5" rx="1.5" fill="white"/>
                <circle cx="17" cy="15.5" r="1.5" fill="rgba(255,255,255,0.75)"/>
              </svg>
            </div>
            <div>
              <div className="font-bold text-base leading-tight" style={{ color: '#2D2440' }}>Toby.AI 企业版</div>
              <div className="text-xs mt-0.5" style={{ color: '#9B8EB5' }}>AIGC 创作平台</div>
            </div>
          </Link>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-4 py-5 space-y-6">
          {navSections.map((section) => (
            <div key={section.label}>
              <div className="px-2 mb-2 text-xs font-semibold tracking-widest uppercase" style={{ color: '#C89BEC', letterSpacing: '0.1em' }}>
                {section.label}
              </div>
              <ul className="space-y-0.5">
                {section.items.map((item) => {
                  const active = pathname === item.href
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium transition-all"
                        style={{
                          color: active ? '#2D2440' : '#9B8EB5',
                          background: active ? 'linear-gradient(135deg, rgba(245,169,98,0.08), rgba(200,155,236,0.08), rgba(107,163,245,0.08))' : 'transparent',
                          borderLeft: active ? '2px solid #C89BEC' : '2px solid transparent',
                        }}
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
        <div className="px-6 py-4" style={{ borderTop: '1px solid #EDE5F5' }}>
          <Link href="/" className="flex items-center gap-1.5 text-xs transition-colors" style={{ color: '#9B8EB5' }}>
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            返回创作平台
          </Link>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-[860px] px-12 py-12">
          <article className="docs-content">
            {children}
          </article>
        </div>
      </main>
    </div>
  )
}
