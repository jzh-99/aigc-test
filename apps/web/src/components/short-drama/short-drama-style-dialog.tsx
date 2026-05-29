'use client'

import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SHORT_DRAMA_STYLE_TABS } from '@aigc/types'
import { SHORT_DRAMA_STYLE_OPTIONS, getShortDramaStylesByTab, type ShortDramaStyleOption } from '@/lib/short-drama/styles'
import type { ShortDramaStyleTab } from '@aigc/types'

interface ShortDramaStyleDialogProps {
  value: string
  onChange: (style: string) => void
  children?: React.ReactNode
}

export function ShortDramaStyleDialog({ value, onChange, children }: ShortDramaStyleDialogProps) {
  const [open, setOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<ShortDramaStyleTab>('全部')
  const [customInput, setCustomInput] = useState('')

  const filteredStyles = getShortDramaStylesByTab(activeTab)

  const handleSelect = (option: ShortDramaStyleOption) => {
    if (option.custom) return
    onChange(option.name)
    setOpen(false)
  }

  const handleCustomConfirm = () => {
    if (customInput.trim()) {
      onChange(customInput.trim())
      setOpen(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {children ?? (
          <Button variant="outline" className="w-full justify-start text-left">
            {value || '选择风格'}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>选择视觉风格</DialogTitle>
        </DialogHeader>

        <div className="flex gap-2 border-b pb-2">
          {SHORT_DRAMA_STYLE_TABS.map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                activeTab === tab
                  ? 'bg-primary text-primary-foreground'
                  : 'hover:bg-muted'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-3 mt-4 max-h-[400px] overflow-y-auto">
          {filteredStyles.map(option => (
            <div
              key={option.id}
              onClick={() => handleSelect(option)}
              className={`p-4 rounded-lg border cursor-pointer transition-all ${
                option.custom ? 'border-dashed' : ''
              } ${
                value === option.name ? 'border-primary bg-primary/5' : 'hover:border-primary/50'
              }`}
            >
              <div className="font-medium text-sm">{option.name}</div>
              <div className="text-xs text-muted-foreground mt-1">{option.description}</div>
              {option.custom && (
                <div className="mt-3 flex gap-2">
                  <Input
                    placeholder="输入自定义风格"
                    value={customInput}
                    onChange={e => setCustomInput(e.target.value)}
                    onClick={e => e.stopPropagation()}
                    className="text-xs h-8"
                  />
                  <Button
                    size="sm"
                    onClick={e => { e.stopPropagation(); handleCustomConfirm() }}
                    disabled={!customInput.trim()}
                    className="h-8"
                  >
                    确定
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
