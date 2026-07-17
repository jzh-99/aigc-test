'use client'

import { useEffect, useState } from 'react'

function formatStableDate(iso: string): string {
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!match) return '未知时间'

  const [, year, month, day] = match
  return `${year}-${month}-${day}`
}

function formatRelativeTime(iso: string): string {
  const timestamp = new Date(iso).getTime()
  if (!Number.isFinite(timestamp)) return formatStableDate(iso)

  const diff = Date.now() - timestamp
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`

  return `${Math.floor(hours / 24)} 天前`
}

export function useRelativeTimeLabel(iso: string): string {
  const [label, setLabel] = useState(() => formatStableDate(iso))

  useEffect(() => {
    const update = () => setLabel(formatRelativeTime(iso))
    update()

    const timer = window.setInterval(update, 60000)
    return () => window.clearInterval(timer)
  }, [iso])

  return label
}
