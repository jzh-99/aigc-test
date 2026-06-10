'use client'

import React, { createContext, useCallback, useContext, useState } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { cn } from '@/lib/utils'

/** 确认对话框配置 */
interface ConfirmOptions {
  /** 标题 */
  title: string
  /** 描述内容 */
  description: string
  /** 确认按钮文字，默认 "确认" */
  confirmText?: string
  /** 取消按钮文字，默认 "取消" */
  cancelText?: string
  /** 确认按钮是否使用危险样式（红色），默认 true */
  destructive?: boolean
}

interface ConfirmState extends Required<ConfirmOptions> {
  open: boolean
  resolver: ((value: boolean) => void) | null
}

const defaultState: ConfirmState = {
  open: false,
  title: '',
  description: '',
  confirmText: '确认',
  cancelText: '取消',
  destructive: true,
  resolver: null,
}

const ConfirmContext = createContext<{
  confirm: (options: ConfirmOptions) => Promise<boolean>
} | null>(null)

/** 确认对话框 Provider，需要在应用根部包裹一次 */
export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<ConfirmState>(defaultState)

  const confirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
    return new Promise((resolve) => {
      setState({
        open: true,
        title: options.title,
        description: options.description,
        confirmText: options.confirmText ?? '确认',
        cancelText: options.cancelText ?? '取消',
        destructive: options.destructive ?? true,
        resolver: resolve,
      })
    })
  }, [])

  const handleAction = useCallback(() => {
    state.resolver?.(true)
    setState((prev) => ({ ...prev, open: false, resolver: null }))
  }, [state.resolver])

  const handleCancel = useCallback(() => {
    state.resolver?.(false)
    setState((prev) => ({ ...prev, open: false, resolver: null }))
  }, [state.resolver])

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}
      <AlertDialog open={state.open} onOpenChange={(open) => { if (!open) handleCancel() }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{state.title}</AlertDialogTitle>
            <AlertDialogDescription className="whitespace-pre-line">
              {state.description}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleCancel}>
              {state.cancelText}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleAction}
              className={cn(state.destructive && 'bg-destructive text-destructive-foreground hover:bg-destructive/90')}
            >
              {state.confirmText}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ConfirmContext.Provider>
  )
}

/**
 * 命令式确认对话框 hook
 *
 * @example
 * ```tsx
 * const confirm = useConfirm()
 * const ok = await confirm({ title: '确认删除？', description: '此操作不可恢复' })
 * if (!ok) return
 * // 执行删除...
 * ```
 */
export function useConfirm() {
  const ctx = useContext(ConfirmContext)
  if (!ctx) {
    throw new Error('useConfirm 必须在 ConfirmProvider 内使用')
  }
  return ctx.confirm
}
