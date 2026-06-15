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
    <div className="rounded-lg border border-[#E7DDF4] bg-white/70 p-4">
      <h3>{title}</h3>
      <div>{children}</div>
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
