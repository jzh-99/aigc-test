export const TTS_SYNC_TEXT_LIMIT = 3000
export const TTS_MAX_TEXT_LENGTH = 10000

export const INTERJECTION_OPTIONS = [
  { value: '(laughs)', label: '笑声' },
  { value: '(chuckle)', label: '轻笑' },
  { value: '(coughs)', label: '咳嗽' },
  { value: '(clear-throat)', label: '清嗓子' },
  { value: '(groans)', label: '呻吟' },
  { value: '(breath)', label: '正常换气' },
  { value: '(pant)', label: '喘气' },
  { value: '(inhale)', label: '吸气' },
  { value: '(exhale)', label: '呼气' },
  { value: '(gasps)', label: '倒吸气' },
  { value: '(sniffs)', label: '吸鼻子' },
  { value: '(sighs)', label: '叹气' },
  { value: '(snorts)', label: '喷鼻息' },
  { value: '(burps)', label: '打嗝' },
  { value: '(lip-smacking)', label: '咂嘴' },
  { value: '(humming)', label: '哼唱' },
  { value: '(hissing)', label: '嘶嘶声' },
  { value: '(emm)', label: '嗯' },
  { value: '(sneezes)', label: '喷嚏' },
] as const

const INTERJECTION_LABEL_BY_VALUE = new Map(INTERJECTION_OPTIONS.map((item) => [item.value, item.label]))

export function countTtsCharacters(text: string): number {
  return Array.from(text).length
}

export function shouldUseStreamingTts(characterCount: number): boolean {
  return characterCount > TTS_SYNC_TEXT_LIMIT
}

export function calculateTtsCredits(characterCount: number, unitPrice: number): number {
  return Math.max(1, Math.ceil(characterCount / 1000)) * unitPrice
}

export function normalizeAudioConfigValue(value: number, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

export function insertAtCursor(text: string, insertion: string, selectionStart: number, selectionEnd: number): string {
  const chars = Array.from(text)
  const start = Math.min(chars.length, Math.max(0, selectionStart))
  const end = Math.min(chars.length, Math.max(start, selectionEnd))
  return `${chars.slice(0, start).join('')}${insertion}${chars.slice(end).join('')}`
}

export function validatePauseSeconds(rawValue: string): number | null {
  const value = rawValue.trim()
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) return null
  const seconds = Number(value)
  if (!Number.isFinite(seconds) || seconds < 0.01 || seconds > 99.99) return null
  return seconds
}

export function toPauseTag(seconds: number): string {
  const normalized = Number(seconds.toFixed(2)).toString()
  return `<#${normalized}#>`
}

export type AudioTagSegment =
  | { type: 'text'; text: string }
  | { type: 'pause'; text: string; label: string }
  | { type: 'interjection'; text: string; label: string }

export function parseAudioTagSegments(value: string): AudioTagSegment[] {
  if (!value) return []

  const tagPattern = /(<#(?:\d+(?:\.\d{1,2})?)#>|\([a-z-]+\))/g
  const segments: AudioTagSegment[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = tagPattern.exec(value))) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', text: value.slice(lastIndex, match.index) })
    }

    const text = match[0]
    const pauseMatch = text.match(/^<#(\d+(?:\.\d{1,2})?)#>$/)
    if (pauseMatch) {
      segments.push({ type: 'pause', text, label: `${Number(pauseMatch[1])}s` })
    } else {
      const label = INTERJECTION_LABEL_BY_VALUE.get(text as (typeof INTERJECTION_OPTIONS)[number]['value'])
      if (label) segments.push({ type: 'interjection', text, label })
      else segments.push({ type: 'text', text })
    }

    lastIndex = match.index + text.length
  }

  if (lastIndex < value.length) {
    segments.push({ type: 'text', text: value.slice(lastIndex) })
  }

  return segments
}
