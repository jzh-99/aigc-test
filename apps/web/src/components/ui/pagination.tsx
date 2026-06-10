'use client'

import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

/** 生成页码数组，中间超出部分用 -1 表示省略号 */
function buildPageNumbers(current: number, totalPages: number): number[] {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1)
  }
  const pages: number[] = [1]
  const left = Math.max(2, current - 1)
  const right = Math.min(totalPages - 1, current + 1)
  if (left > 2) pages.push(-1)
  for (let i = left; i <= right; i++) pages.push(i)
  if (right < totalPages - 1) pages.push(-1)
  pages.push(totalPages)
  return pages
}

const PAGE_SIZE_OPTIONS = [10, 20, 50] as const

export interface PaginationProps {
  /** 当前页码（从 1 开始） */
  page: number
  /** 总页数 */
  totalPages: number
  /** 每页数量 */
  pageSize: number
  /** 页码变化回调 */
  onPageChange: (page: number) => void
  /** 每页数量变化回调 */
  onPageSizeChange: (pageSize: number) => void
}

export function Pagination({ page, totalPages, pageSize, onPageChange, onPageSizeChange }: PaginationProps) {
  if (totalPages <= 0) return null

  const pages = buildPageNumbers(page, totalPages)

  return (
    <div className="flex items-center justify-between gap-3 pt-3">
      {/* 每页数量选择 */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span>每页</span>
        <Select
          value={String(pageSize)}
          onValueChange={(val) => onPageSizeChange(Number(val))}
        >
          <SelectTrigger className="h-8 w-[80px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PAGE_SIZE_OPTIONS.map((size) => (
              <SelectItem key={size} value={String(size)}>{size} 条</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* 页码导航 */}
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>

        {pages.map((p, idx) =>
          p === -1 ? (
            <span key={`ellipsis-${idx}`} className="px-1 text-muted-foreground">…</span>
          ) : (
            <Button
              key={p}
              variant={p === page ? 'default' : 'outline'}
              size="icon"
              className="h-8 w-8"
              onClick={() => onPageChange(p)}
            >
              {p}
            </Button>
          ),
        )}

        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
