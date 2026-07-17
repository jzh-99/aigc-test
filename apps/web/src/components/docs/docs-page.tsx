import type { ReactNode } from 'react'
import Link from 'next/link'

export function DocsPage({ title, lead, children }: { title: string; lead?: string; children: ReactNode }) {
  return (
    <>
      <h1>{title}</h1>
      {lead ? <p>{lead}</p> : null}
      {children}
    </>
  )
}

export function DocsFigure({ src, alt, caption }: { src: string; alt: string; caption?: string }) {
  return (
    <figure>
      <img src={src} alt={alt} />
      {caption ? <figcaption>{caption}</figcaption> : null}
    </figure>
  )
}

export function DocsCards({ children }: { children: ReactNode }) {
  return <div className="grid gap-4 md:grid-cols-2">{children}</div>
}

export function DocsCard({ title, children, href }: { title: string; children: ReactNode; href?: string }) {
  const body = (
    <div className="group relative overflow-hidden rounded-lg border border-violet-300/18 bg-[linear-gradient(135deg,rgba(89,70,170,0.28),rgba(20,33,72,0.44)_48%,rgba(10,15,34,0.62))] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_18px_40px_rgba(0,0,0,0.18)] transition duration-200 hover:border-violet-300/38 hover:bg-[linear-gradient(135deg,rgba(118,85,214,0.34),rgba(29,48,96,0.48)_48%,rgba(12,18,40,0.68))]">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent" />
      <div className="pointer-events-none absolute -right-16 -top-20 h-36 w-36 rounded-full bg-violet-300/12 blur-3xl transition-opacity duration-200 group-hover:opacity-80" />
      <h3 className="relative text-white">{title}</h3>
      <div className="relative text-[#BFD0F2]">{children}</div>
    </div>
  )

  if (!href) return body

  return (
    <Link href={href} className="block no-underline">
      {body}
    </Link>
  )
}

export function DocsNote({ children }: { children: ReactNode }) {
  return <blockquote>{children}</blockquote>
}

export function DocsSteps({ children }: { children: ReactNode }) {
  return <ol>{children}</ol>
}
