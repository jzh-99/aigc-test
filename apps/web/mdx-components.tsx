import React from 'react'

function DocsFlowChart({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      margin: '1.25rem 0',
      padding: '1.25rem 1.5rem',
      background: 'linear-gradient(135deg, rgba(245,169,98,0.05), rgba(200,155,236,0.07), rgba(107,163,245,0.05))',
      border: '1px solid #EDE5F5',
      borderRadius: '10px',
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Menlo', monospace",
      fontSize: '0.875rem',
      lineHeight: '1.9',
      color: '#4A4060',
      whiteSpace: 'pre',
      overflowX: 'auto',
    }}>
      {children}
    </div>
  )
}

function DocsPre({ children, ...props }: React.HTMLAttributes<HTMLPreElement> & { children?: React.ReactNode }) {
  // Detect flow chart: plain code block containing ↓ arrows
  const text = typeof children === 'object' && children !== null && 'props' in (children as React.ReactElement)
    ? ((children as React.ReactElement).props?.children as string) ?? ''
    : ''

  if (typeof text === 'string' && text.includes('↓')) {
    return <DocsFlowChart>{text}</DocsFlowChart>
  }

  return <pre {...props}>{children}</pre>
}

export function useMDXComponents(components: Record<string, React.ComponentType>) {
  return {
    ...components,
    pre: DocsPre as React.ComponentType,
  }
}
