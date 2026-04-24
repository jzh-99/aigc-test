import type { Metadata } from 'next'

export const metadata: Metadata = { title: '视频工坊' }

export default function VideoStudioLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
