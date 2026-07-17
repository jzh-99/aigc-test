'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { docsNavSections } from '@/components/docs/docs-data'

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

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
          {docsNavSections.map((section) => (
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
