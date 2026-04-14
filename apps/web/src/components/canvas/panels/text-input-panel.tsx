interface TextInputPanelProps {
  textDraft: string
  setTextDraft: (value: string) => void
  flushTextDraft: () => void
  upstreamTextNodeLabels: string[]
}

export function TextInputPanel({
  textDraft,
  setTextDraft,
  flushTextDraft,
  upstreamTextNodeLabels,
}: TextInputPanelProps) {
  return (
    <div className="p-3">
      <label className="text-[11px] font-medium text-muted-foreground block mb-1">文本内容</label>
      {upstreamTextNodeLabels.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-1.5">
          {upstreamTextNodeLabels.map((label, i) => (
            <span key={i} className="inline-flex items-center px-1.5 py-0.5 rounded bg-blue-50 border border-blue-200 text-[10px] text-blue-600 font-medium">
              [{label}]+
            </span>
          ))}
        </div>
      )}
      <textarea
        className="w-full h-20 p-2 text-xs bg-muted/60 rounded-lg resize-none focus:outline-none focus:ring-1 focus:ring-primary"
        placeholder="输入提示词内容..."
        value={textDraft}
        onChange={(e) => setTextDraft(e.target.value)}
        onBlur={flushTextDraft}
      />
    </div>
  )
}
