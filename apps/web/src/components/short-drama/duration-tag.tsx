'use client'

interface DurationTagProps {
  value: number
  onChange: (value: number) => void
  allowedDurations?: number[]
  disabled?: boolean
}

const DEFAULT_ALLOWED = [4, 5, 8]

export function DurationTag({ value, onChange, allowedDurations = DEFAULT_ALLOWED, disabled }: DurationTagProps) {
  return (
    <div className="flex items-center gap-1">
      {allowedDurations.map(d => (
        <button
          key={d}
          onClick={() => onChange(d)}
          disabled={disabled}
          className={`px-2 py-0.5 text-xs rounded transition-colors ${
            value === d
              ? 'bg-primary text-primary-foreground'
              : 'bg-muted hover:bg-muted/80 text-muted-foreground'
          } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          {d}s
        </button>
      ))}
    </div>
  )
}
