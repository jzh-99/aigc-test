'use client'

import { useEffect, useRef, useState } from 'react'
import { Loader2, Sparkles, Check, Pencil, Save, X, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { SHORT_DRAMA_ORIGINAL_SCRIPT_MAX_CHARS } from '@aigc/types'
import type { ShortDramaState } from '@aigc/types'
import {
  generateShortDramaScriptSummary,
  generateShortDramaEpisodeOutlines,
  saveShortDramaProject,
  updateShortDramaScriptSource,
} from '@/lib/short-drama/api'

interface StepScriptOutlineProps {
  projectId: string
  state: ShortDramaState
  onStateChange: () => void
}

const SUMMARY_HEADINGS = [
  '集数',
  '故事类型',
  '目标受众',
  '核心梗',
  '一句话故事',
  '人物小传',
  '故事梗概',
  '导演阐述',
  '影像风格',
  '妆造方向',
  '核心场景与布景',
  '灯光气质',
] as const

type SummaryHeading = (typeof SUMMARY_HEADINGS)[number]
type SummaryDraft = Record<SummaryHeading, string>
type CharacterBioDialogDraft = {
  mode: 'add' | 'edit'
  originalName: string | null
  name: string
  fields: CharacterBioFields
}
type EpisodeOutlineDialogDraft = {
  episodeNumber: number
  mode: 'title' | 'scene'
  sceneIndex?: number
  label: string
  value: string
}
type EpisodeSceneBlock = {
  heading: string
  body: string
}

const CHARACTER_NAME_MAX_LENGTH = 20
const CHARACTER_BIO_MAX_LENGTH = 1200
const EPISODE_TITLE_MAX_LENGTH = 30
const EPISODE_SCENE_MAX_LENGTH = 2500
const ORIGINAL_PROMPT_MAX_LENGTH = 2000

const CHARACTER_BIO_FIELDS = [
  '角色类型',
  '视觉形象',
  '核心标签',
  '身份背景',
  '成长经历',
  '性格特点',
  '角色关系',
  '成长弧线',
] as const

type CharacterBioField = (typeof CHARACTER_BIO_FIELDS)[number]
type CharacterBioFields = Record<CharacterBioField, string>
const CHARACTER_BIO_FIELD_LIMITS: Record<CharacterBioField, number> = {
  角色类型: 50,
  视觉形象: 200,
  核心标签: 50,
  身份背景: 200,
  成长经历: 200,
  性格特点: 100,
  角色关系: 200,
  成长弧线: 200,
}

function useTypewriterText(targetText: string, active: boolean, speedMs = 12): string {
  const [displayText, setDisplayText] = useState('')

  useEffect(() => {
    if (!active) {
      setDisplayText('')
      return
    }
    if (!targetText) {
      setDisplayText('')
      return
    }
    if (displayText.length >= targetText.length) return

    const timer = window.setTimeout(() => {
      const step = targetText.length - displayText.length > 80 ? 4 : 2
      setDisplayText(targetText.slice(0, displayText.length + step))
    }, speedMs)

    return () => window.clearTimeout(timer)
  }, [active, displayText.length, speedMs, targetText])

  return displayText
}

function TypewriterStreamBlock({
  value,
  className,
}: {
  value: string
  className: string
}) {
  return (
    <div className={className}>
      {value}
      <span className="ml-0.5 inline-block h-4 w-1 translate-y-0.5 animate-pulse rounded-sm bg-current" />
    </div>
  )
}

function parseScriptSummary(value: string): Partial<Record<SummaryHeading, string>> {
  const lines = value
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)

  const sections: Partial<Record<SummaryHeading, string[]>> = {}
  let current: SummaryHeading | null = null

  for (const line of lines) {
    if ((SUMMARY_HEADINGS as readonly string[]).includes(line)) {
      current = line as SummaryHeading
      sections[current] = []
      continue
    }

    if (!current) continue
    sections[current]?.push(line)
  }

  return Object.fromEntries(
    Object.entries(sections).map(([key, sectionLines]) => [key, sectionLines.join('\n')])
  ) as Partial<Record<SummaryHeading, string>>
}

function createSummaryDraft(value: string, episodeCount: number): SummaryDraft {
  const sections = parseScriptSummary(value)
  const hasStructuredContent = SUMMARY_HEADINGS.some(heading => sections[heading])

  return SUMMARY_HEADINGS.reduce((draft, heading) => {
    draft[heading] = heading === '集数'
      ? (sections[heading] || String(episodeCount))
      : (!hasStructuredContent && heading === '故事梗概' ? value.trim() : sections[heading] || '')
    return draft
  }, {} as SummaryDraft)
}

function buildScriptSummary(draft: SummaryDraft): string {
  return SUMMARY_HEADINGS
    .map((heading) => {
      const value = draft[heading].trim()
      if (!value && heading !== '集数') return ''
      return `${heading}\n${value}`
    })
    .filter(Boolean)
    .join('\n')
}

function buildCharacterBios(bios: Array<{ name: string; body: string }>): string {
  return bios
    .map(bio => `${bio.name}\n${bio.body.trim()}`)
    .join('\n')
}

function parseEpisodeSceneBlocks(value: string): EpisodeSceneBlock[] {
  const lines = value.split(/\r?\n/)
  const blocks: EpisodeSceneBlock[] = []
  let current: EpisodeSceneBlock | null = null

  for (const line of lines) {
    if (/^###\s*场/.test(line.trim())) {
      if (current) blocks.push(current)
      current = { heading: line.trim(), body: '' }
      continue
    }

    if (!current) {
      if (line.trim()) {
        current = { heading: '补充说明', body: line }
      }
      continue
    }

    current.body = [current.body, line].filter(Boolean).join('\n')
  }

  if (current) blocks.push(current)
  return blocks
}

function buildEpisodeSummaryFromBlocks(blocks: EpisodeSceneBlock[]): string {
  return blocks
    .map(block => `${block.heading}\n${block.body.trim()}`.trim())
    .filter(Boolean)
    .join('\n\n')
}

function parseCharacterBios(value: string): Array<{ name: string; body: string }> {
  const lines = value
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)

  const bios: Array<{ name: string; body: string[] }> = []

  for (const line of lines) {
    const isCharacterName = !line.includes('：') && !line.includes(':')
    if (isCharacterName) {
      bios.push({ name: line, body: [] })
      continue
    }

    const current = bios[bios.length - 1]
    if (current) current.body.push(line)
  }

  return bios
    .filter(bio => bio.name && bio.body.length > 0)
    .map(bio => ({ name: bio.name, body: bio.body.join('\n') }))
}

function upsertCharacterBio(
  value: string,
  originalName: string | null,
  nextBio: { name: string; body: string }
): string {
  const bios = parseCharacterBios(value)
  const matched = originalName
    ? bios.some(bio => bio.name === originalName)
    : false

  if (!matched) {
    return buildCharacterBios([...bios, nextBio])
  }

  return buildCharacterBios(bios.map(bio => (
    bio.name === originalName ? nextBio : bio
  )))
}

function createEmptyCharacterBioFields(): CharacterBioFields {
  return CHARACTER_BIO_FIELDS.reduce((fields, field) => {
    fields[field] = ''
    return fields
  }, {} as CharacterBioFields)
}

function parseCharacterBioFields(body: string): CharacterBioFields {
  const fields = createEmptyCharacterBioFields()
  let currentField: CharacterBioField | null = null

  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue

    const match = line.match(/^([^：:]+)[：:]\s*(.*)$/)
    if (match && (CHARACTER_BIO_FIELDS as readonly string[]).includes(match[1])) {
      currentField = match[1] as CharacterBioField
      fields[currentField] = match[2].trim()
      continue
    }

    if (currentField) {
      fields[currentField] = [fields[currentField], line].filter(Boolean).join('\n')
    } else {
      fields.身份背景 = [fields.身份背景, line].filter(Boolean).join('\n')
    }
  }

  return fields
}

function buildCharacterBioBody(fields: CharacterBioFields): string {
  return CHARACTER_BIO_FIELDS
    .map((field) => {
      const value = fields[field].trim()
      return value ? `${field}：${value}` : ''
    })
    .filter(Boolean)
    .join('\n')
}

function makeNewCharacterName(value: string): string {
  const names = new Set(parseCharacterBios(value).map(bio => bio.name))
  let index = names.size + 1
  let name = `新人物${index}`
  while (names.has(name)) {
    index += 1
    name = `新人物${index}`
  }
  return name
}

function SummaryIconButton({
  label,
  onClick,
  disabled,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className="h-8 w-8 shrink-0 rounded-full border border-transparent p-0 text-muted-foreground opacity-70 transition hover:border-border hover:bg-background hover:text-foreground hover:opacity-100"
    >
      <Pencil className="h-3.5 w-3.5" />
    </Button>
  )
}

function SummaryEditActions({
  saving,
  onSave,
  onCancel,
}: {
  saving: boolean
  onSave: () => void
  onCancel: () => void
}) {
  return (
    <div className="flex justify-end gap-2">
      <Button
        size="sm"
        variant="outline"
        onClick={onCancel}
        disabled={saving}
        className="border-border/80 bg-background/90 text-foreground shadow-sm hover:bg-muted dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:border-slate-500 dark:hover:bg-slate-800"
      >
        <X className="mr-1 h-3.5 w-3.5" />
        取消
      </Button>
      <Button size="sm" onClick={onSave} disabled={saving}>
        {saving ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1 h-3.5 w-3.5" />}
        保存
      </Button>
    </div>
  )
}

function SummaryTextBlock({
  title,
  heading,
  value,
  canEdit,
  editing,
  saving,
  draftValue,
  onEdit,
  onChange,
  onSave,
  onCancel,
}: {
  title: string
  heading: SummaryHeading
  value?: string
  canEdit?: boolean
  editing?: boolean
  saving?: boolean
  draftValue?: string
  onEdit?: (heading: SummaryHeading) => void
  onChange?: (heading: SummaryHeading, value: string) => void
  onSave?: (heading: SummaryHeading) => void
  onCancel?: () => void
}) {
  const children = editing ? draftValue ?? '' : value
  if (!editing && !children) return null

  return (
    <section className="rounded-xl border border-border/70 bg-card/70 p-5 shadow-sm dark:border-slate-800 dark:bg-slate-950/45 dark:shadow-none">
      <div className="flex items-center justify-between gap-3">
        <h4 className="text-xs font-semibold tracking-wide text-muted-foreground">{title}</h4>
        {canEdit && !editing && onEdit && (
          <SummaryIconButton label={`编辑${title}`} onClick={() => onEdit(heading)} />
        )}
      </div>
      {editing ? (
        <div className="mt-3 space-y-3">
          <textarea
            value={draftValue ?? ''}
            onChange={event => onChange?.(heading, event.target.value)}
            className="min-h-[132px] w-full resize-y rounded-xl border bg-white px-3 py-2 text-sm leading-6 outline-none transition focus:border-primary/40 focus:ring-2 focus:ring-primary/20 dark:bg-slate-950"
          />
          <SummaryEditActions
            saving={Boolean(saving)}
            onSave={() => onSave?.(heading)}
            onCancel={() => onCancel?.()}
          />
        </div>
      ) : (
        <div className="mt-2 whitespace-pre-wrap text-sm leading-7 text-foreground">
          {children}
        </div>
      )}
    </section>
  )
}

function SummaryTopCard({
  label,
  heading,
  value,
  canEdit,
  editing,
  saving,
  draftValue,
  onEdit,
  onChange,
  onSave,
  onCancel,
}: {
  label: SummaryHeading
  heading: SummaryHeading
  value?: string
  canEdit: boolean
  editing: boolean
  saving: boolean
  draftValue: string
  onEdit: (heading: SummaryHeading) => void
  onChange: (heading: SummaryHeading, value: string) => void
  onSave: (heading: SummaryHeading) => void
  onCancel: () => void
}) {
  return (
    <div className="min-h-[118px] rounded-xl border border-transparent bg-muted/35 px-4 py-4 dark:bg-slate-900/65">
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs font-semibold tracking-wide text-muted-foreground">{label}</div>
        {canEdit && !editing && (
          <SummaryIconButton label={`编辑${label}`} onClick={() => onEdit(heading)} />
        )}
      </div>
      {editing ? (
        <div className="mt-2 space-y-2">
          <input
            value={draftValue}
            onChange={event => onChange(heading, event.target.value)}
            className="h-10 w-full rounded-xl border bg-white px-3 text-sm outline-none transition focus:border-primary/40 focus:ring-2 focus:ring-primary/20 dark:bg-slate-950"
          />
          <SummaryEditActions
            saving={saving}
            onSave={() => onSave(heading)}
            onCancel={onCancel}
          />
        </div>
      ) : (
        <div className="mt-2 text-base font-semibold leading-6 text-foreground">{value || '-'}</div>
      )}
    </div>
  )
}

function CharacterBioDialog({
  value,
  saving,
  onChange,
  onClose,
  onSave,
}: {
  value: CharacterBioDialogDraft | null
  saving: boolean
  onChange: (value: CharacterBioDialogDraft) => void
  onClose: () => void
  onSave: () => void
}) {
  const nameLength = value?.name.length ?? 0
  const bodyLength = value ? buildCharacterBioBody(value.fields).length : 0
  const nameExceeded = nameLength > CHARACTER_NAME_MAX_LENGTH
  const bodyExceeded = bodyLength > CHARACTER_BIO_MAX_LENGTH

  return (
    <Dialog open={Boolean(value)} onOpenChange={(open) => {
      if (!open && !saving) onClose()
    }}>
      <DialogContent className="max-h-[86vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{value?.mode === 'add' ? '新增人物小传' : '编辑人物小传'}</DialogTitle>
          <DialogDescription>
            人物小传会作为后续角色素材和片段脚本的重要参考，请保持姓名、身份和视觉形象稳定。
          </DialogDescription>
        </DialogHeader>

        {value && (
          <div className="space-y-4">
            <label className="block space-y-1.5">
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs font-medium text-muted-foreground">人物名称</span>
                <span className={`text-xs ${nameExceeded ? 'text-destructive' : 'text-muted-foreground'}`}>
                  {nameLength}/{CHARACTER_NAME_MAX_LENGTH}
                </span>
              </div>
              <input
                value={value.name}
                maxLength={CHARACTER_NAME_MAX_LENGTH}
                onChange={event => onChange({ ...value, name: event.target.value })}
                placeholder="例如：林辰、赵晓雨、王总"
                className="h-10 w-full rounded-xl border bg-white px-3 text-sm outline-none transition focus:border-primary/40 focus:ring-2 focus:ring-primary/20 dark:bg-slate-950"
              />
            </label>

            <div className="space-y-3 rounded-xl border border-border/70 bg-muted/25 p-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs font-medium text-muted-foreground">人物小传字段</span>
                <span className={`text-xs ${bodyExceeded ? 'text-destructive' : 'text-muted-foreground'}`}>
                  {bodyLength}/{CHARACTER_BIO_MAX_LENGTH}
                </span>
              </div>
              <div className="space-y-3">
                {CHARACTER_BIO_FIELDS.map((field) => {
                  const fieldValue = value.fields[field]
                  const fieldLength = fieldValue.length
                  const fieldLimit = CHARACTER_BIO_FIELD_LIMITS[field]
                  const fieldExceeded = fieldLength > fieldLimit
                  return (
                    <label key={field} className="block space-y-1.5">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-xs font-medium text-muted-foreground">{field}</span>
                        <span className={`text-xs ${fieldExceeded ? 'text-destructive' : 'text-muted-foreground'}`}>
                          {fieldLength}/{fieldLimit}
                        </span>
                      </div>
                      <textarea
                        value={fieldValue}
                        maxLength={fieldLimit}
                        onChange={event => onChange({
                          ...value,
                          fields: {
                            ...value.fields,
                            [field]: event.target.value,
                          },
                        })}
                        placeholder={`${field}，留空则不写入整体摘要`}
                        className="min-h-[104px] w-full resize-y rounded-xl border bg-white px-3 py-2 text-sm leading-6 outline-none transition focus:border-primary/40 focus:ring-2 focus:ring-primary/20 dark:bg-slate-950"
                      />
                    </label>
                  )
                })}
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            取消
          </Button>
          <Button onClick={onSave} disabled={saving || !value}>
            {saving ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1 h-3.5 w-3.5" />}
            保存人物
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function EpisodeOutlineDialog({
  value,
  saving,
  onChange,
  onClose,
  onSave,
}: {
  value: EpisodeOutlineDialogDraft | null
  saving: boolean
  onChange: (value: EpisodeOutlineDialogDraft) => void
  onClose: () => void
  onSave: () => void
}) {
  const maxLength = value?.mode === 'title' ? EPISODE_TITLE_MAX_LENGTH : EPISODE_SCENE_MAX_LENGTH
  const currentLength = value?.value.length ?? 0
  const exceeded = currentLength > maxLength

  return (
    <Dialog open={Boolean(value)} onOpenChange={(open) => {
      if (!open && !saving) onClose()
    }}>
      <DialogContent className="max-h-[86vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{value?.mode === 'title' ? '编辑分集标题' : '编辑分场剧本'}</DialogTitle>
          <DialogDescription>
            {value?.label || '调整分集剧本内容'}，保存后会同步到该集剧本结构。
          </DialogDescription>
        </DialogHeader>

        {value && (
          <label className="block space-y-1.5">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-medium text-muted-foreground">
                {value.mode === 'title' ? '标题' : '分场正文'}
              </span>
              <span className={`text-xs ${exceeded ? 'text-destructive' : 'text-muted-foreground'}`}>
                {currentLength}/{maxLength}
              </span>
            </div>
            {value.mode === 'title' ? (
              <input
                value={value.value}
                maxLength={maxLength}
                onChange={event => onChange({ ...value, value: event.target.value })}
                className="h-10 w-full rounded-xl border bg-white px-3 text-sm outline-none transition focus:border-primary/40 focus:ring-2 focus:ring-primary/20 dark:bg-slate-950"
              />
            ) : (
              <textarea
                value={value.value}
                maxLength={maxLength}
                onChange={event => onChange({ ...value, value: event.target.value })}
                className="min-h-[320px] w-full resize-y rounded-xl border bg-white px-3 py-2 text-sm leading-6 outline-none transition focus:border-primary/40 focus:ring-2 focus:ring-primary/20 dark:bg-slate-950"
              />
            )}
          </label>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            取消
          </Button>
          <Button onClick={onSave} disabled={saving || !value}>
            {saving ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1 h-3.5 w-3.5" />}
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ScriptSummaryView({
  value,
  draft,
  canEdit,
  editingHeading,
  savingHeading,
  onEditHeading,
  onChangeHeading,
  onSaveHeading,
  onCancelEdit,
  onEditCharacter,
  onAddCharacter,
}: {
  value: string
  draft: SummaryDraft
  canEdit: boolean
  editingHeading: SummaryHeading | null
  savingHeading: SummaryHeading | null
  onEditHeading: (heading: SummaryHeading) => void
  onChangeHeading: (heading: SummaryHeading, value: string) => void
  onSaveHeading: (heading: SummaryHeading) => void
  onCancelEdit: () => void
  onEditCharacter: (name: string) => void
  onAddCharacter: () => void
}) {
  const sections = parseScriptSummary(value)
  const displayCharacterBios = sections.人物小传 ? parseCharacterBios(sections.人物小传) : []
  const hasStructuredContent = SUMMARY_HEADINGS.some(heading => sections[heading])
  const canStartEdit = canEdit && !editingHeading

  if (!hasStructuredContent) {
    return (
      <div className="whitespace-pre-wrap rounded-lg bg-muted/50 p-3 text-sm leading-6">
        {value}
      </div>
    )
  }

  return (
    <div className="space-y-4 rounded-2xl border border-border/70 bg-card/70 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950/40 dark:shadow-none">
      <div className="grid gap-3 md:grid-cols-3">
        {[
          { label: '集数', value: sections.集数 },
          { label: '故事类型', value: sections.故事类型 },
          { label: '目标受众', value: sections.目标受众 },
        ].map(item => (
          <SummaryTopCard
            key={item.label}
            label={item.label as SummaryHeading}
            heading={item.label as SummaryHeading}
            value={item.value}
            canEdit={canStartEdit && item.label !== '集数'}
            editing={editingHeading === item.label}
            saving={savingHeading === item.label}
            draftValue={draft[item.label as SummaryHeading]}
            onEdit={onEditHeading}
            onChange={onChangeHeading}
            onSave={onSaveHeading}
            onCancel={onCancelEdit}
          />
        ))}
      </div>

      <SummaryTextBlock title="核心梗" heading="核心梗" value={sections.核心梗} canEdit={canStartEdit} editing={editingHeading === '核心梗'} saving={savingHeading === '核心梗'} draftValue={draft.核心梗} onEdit={onEditHeading} onChange={onChangeHeading} onSave={onSaveHeading} onCancel={onCancelEdit} />
      <SummaryTextBlock title="一句话故事" heading="一句话故事" value={sections.一句话故事} canEdit={canStartEdit} editing={editingHeading === '一句话故事'} saving={savingHeading === '一句话故事'} draftValue={draft.一句话故事} onEdit={onEditHeading} onChange={onChangeHeading} onSave={onSaveHeading} onCancel={onCancelEdit} />

      {displayCharacterBios.length > 0 ? (
        <section id="short-drama-character-bios" className="scroll-mt-24 rounded-xl border border-border/70 bg-card/70 p-5 shadow-sm dark:border-slate-800 dark:bg-slate-950/45 dark:shadow-none">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h4 className="text-xs font-semibold tracking-wide text-muted-foreground">人物小传</h4>
              <p className="mt-1 text-xs text-muted-foreground/70">按角色独立维护，后续角色素材会优先参考这里。</p>
            </div>
            <div className="flex items-center gap-1">
              {canStartEdit && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  title="新增人物"
                  aria-label="新增人物"
                  className="h-8 w-8 rounded-full border border-transparent p-0 text-muted-foreground opacity-80 transition hover:border-border hover:bg-background hover:text-foreground hover:opacity-100"
                  onClick={onAddCharacter}
                >
                  <Plus className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          </div>
          {editingHeading === '人物小传' ? (
            <div className="mt-3 space-y-3">
              <textarea
                value={draft.人物小传}
                onChange={event => onChangeHeading('人物小传', event.target.value)}
                className="min-h-[180px] w-full resize-y rounded-xl border bg-white px-3 py-2 text-sm leading-6 outline-none transition focus:border-primary/40 focus:ring-2 focus:ring-primary/20 dark:bg-slate-950"
              />
              <SummaryEditActions
                saving={savingHeading === '人物小传'}
                onSave={() => onSaveHeading('人物小传')}
                onCancel={onCancelEdit}
              />
            </div>
          ) : (
          <div className="mt-4 grid gap-3">
            {displayCharacterBios.map(bio => {
              return (
              <div key={bio.name} className="rounded-xl border border-border/60 bg-muted/30 p-4 dark:bg-slate-900/60">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold text-foreground">{bio.name}</div>
                  {canStartEdit && editingHeading !== '人物小传' && (
                    <SummaryIconButton label={`编辑${bio.name}小传`} onClick={() => onEditCharacter(bio.name)} />
                  )}
                </div>
                <div className="mt-2 whitespace-pre-wrap text-sm leading-7 text-muted-foreground">
                  {bio.body}
                </div>
              </div>
            )})}
          </div>
          )}
        </section>
      ) : (
        <SummaryTextBlock title="人物小传" heading="人物小传" value={sections.人物小传} canEdit={canStartEdit} editing={editingHeading === '人物小传'} saving={savingHeading === '人物小传'} draftValue={draft.人物小传} onEdit={onEditHeading} onChange={onChangeHeading} onSave={onSaveHeading} onCancel={onCancelEdit} />
      )}

      <SummaryTextBlock title="故事梗概" heading="故事梗概" value={sections.故事梗概} canEdit={canStartEdit} editing={editingHeading === '故事梗概'} saving={savingHeading === '故事梗概'} draftValue={draft.故事梗概} onEdit={onEditHeading} onChange={onChangeHeading} onSave={onSaveHeading} onCancel={onCancelEdit} />
    </div>
  )
}

function EpisodeOutlineList({
  outlines,
  canEdit,
  onEditTitle,
  onEditScene,
}: {
  outlines: Array<{ episodeNumber: number; title: string; summary: string }>
  canEdit: boolean
  onEditTitle: (episodeNumber: number) => void
  onEditScene: (episodeNumber: number, sceneIndex: number) => void
}) {
  const groups = buildEpisodeOutlineGroups(outlines)

  return (
    <div className="space-y-5">
      {groups.map(group => (
        <div key={group.id} id={group.id} className="scroll-mt-24 space-y-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
            <span className="h-px flex-1 bg-border/70" />
            <span>第 {group.label} 集</span>
            <span className="h-px flex-1 bg-border/70" />
          </div>
          {group.outlines.map(outline => {
            const scenes = parseEpisodeSceneBlocks(outline.summary)
            return (
              <section key={outline.episodeNumber} className="rounded-xl border border-border/70 bg-card/70 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950/40 dark:shadow-none">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-xs font-medium text-muted-foreground">第 {outline.episodeNumber} 集</div>
                    <h4 className="mt-1 text-sm font-semibold text-foreground">{outline.title}</h4>
                  </div>
                  {canEdit && (
                    <SummaryIconButton label={`编辑第${outline.episodeNumber}集标题`} onClick={() => onEditTitle(outline.episodeNumber)} />
                  )}
                </div>

                <div className="mt-3 space-y-2">
                  {scenes.length > 0 ? scenes.map((scene, index) => (
                    <div key={`${outline.episodeNumber}-${scene.heading}-${index}`} className="rounded-lg border border-border/60 bg-muted/25 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-xs font-semibold text-muted-foreground">{scene.heading}</div>
                        {canEdit && (
                          <SummaryIconButton label={`编辑${scene.heading}`} onClick={() => onEditScene(outline.episodeNumber, index)} />
                        )}
                      </div>
                      <div className="mt-2 whitespace-pre-wrap text-xs leading-6 text-muted-foreground">
                        {scene.body}
                      </div>
                    </div>
                  )) : (
                    <div className="whitespace-pre-wrap rounded-lg border border-border/60 bg-muted/25 p-3 text-xs leading-6 text-muted-foreground">
                      {outline.summary}
                    </div>
                  )}
                </div>
              </section>
            )
          })}
        </div>
      ))}
    </div>
  )
}

const EPISODE_NAV_GROUP_SIZE = 5

function formatEpisodeRangeLabel(from: number, to: number): string {
  return from === to ? String(from) : `${from}-${to}`
}

function buildEpisodeOutlineGroups(outlines: Array<{ episodeNumber: number; title: string; summary: string }>) {
  const groups: Array<{
    id: string
    label: string
    from: number
    to: number
    outlines: Array<{ episodeNumber: number; title: string; summary: string }>
  }> = []

  for (const outline of outlines) {
    const groupIndex = Math.floor((outline.episodeNumber - 1) / EPISODE_NAV_GROUP_SIZE)
    const from = groupIndex * EPISODE_NAV_GROUP_SIZE + 1
    const to = from + EPISODE_NAV_GROUP_SIZE - 1
    let group = groups.find(item => item.from === from)
    if (!group) {
      group = {
        id: `short-drama-outlines-${from}-${to}`,
        label: formatEpisodeRangeLabel(from, to),
        from,
        to,
        outlines: [],
      }
      groups.push(group)
    }
    group.outlines.push(outline)
  }

  return groups.map((group) => {
    const firstEpisodeNumber = group.outlines[0]?.episodeNumber ?? group.from
    const lastEpisodeNumber = group.outlines[group.outlines.length - 1]?.episodeNumber ?? group.to
    return {
      ...group,
      label: formatEpisodeRangeLabel(firstEpisodeNumber, lastEpisodeNumber),
    }
  })
}

function formatOutlineProgressMessage(message: string): string {
  if (!message) return ''
  return message
    .replace(/大纲/g, '剧本')
    .replace(/分集剧本剧本/g, '分集剧本')
}

function getCurrentOutlineProgressMessage(state: StepScriptOutlineProps['state'], message: string): string {
  const formattedMessage = formatOutlineProgressMessage(message)
  if (formattedMessage) return formattedMessage

  const from = state.script.outlines.length + 1
  const to = Math.min(from + EPISODE_NAV_GROUP_SIZE - 1, state.settings.episodeCount)
  if (from <= state.settings.episodeCount) {
    return `正在生成第 ${formatEpisodeRangeLabel(from, to)} 集剧本，页面会自动刷新状态...`
  }
  return '正在生成分集剧本，页面会自动刷新状态...'
}

export function StepScriptOutline({ projectId, state, onStateChange }: StepScriptOutlineProps) {
  const [generatingSummary, setGeneratingSummary] = useState(false)
  const [generatingOutlines, setGeneratingOutlines] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [summaryStreamText, setSummaryStreamText] = useState('')
  const [outlineStreamText, setOutlineStreamText] = useState('')
  const [outlineProgressMessage, setOutlineProgressMessage] = useState('')
  const [streamWarningMessage, setStreamWarningMessage] = useState('')
  const [editingSummaryHeading, setEditingSummaryHeading] = useState<SummaryHeading | null>(null)
  const [characterBioDialog, setCharacterBioDialog] = useState<CharacterBioDialogDraft | null>(null)
  const [summaryDraft, setSummaryDraft] = useState<SummaryDraft>(() =>
    createSummaryDraft(state.script.refinedPrompt ?? '', state.settings.episodeCount)
  )
  const [savingSummaryHeading, setSavingSummaryHeading] = useState<SummaryHeading | null>(null)
  const [episodeOutlineDialog, setEpisodeOutlineDialog] = useState<EpisodeOutlineDialogDraft | null>(null)
  const [savingEpisodeOutline, setSavingEpisodeOutline] = useState(false)
  const [sourceEditOpen, setSourceEditOpen] = useState(false)
  const [sourceEditDraft, setSourceEditDraft] = useState('')
  const [savingSourceEdit, setSavingSourceEdit] = useState(false)
  const generatingSummaryRef = useRef(false)
  const generatingOutlinesRef = useRef(false)
  const typedSummaryStreamText = useTypewriterText(summaryStreamText, generatingSummary)
  const typedOutlineStreamText = useTypewriterText(outlineStreamText, generatingOutlines)
  const isLocked = state.locks.script
  const isSummaryGenerating = generatingSummary || (state.script.status === 'generating' && !state.script.refinedPrompt)
  const canEditSource = !isLocked && !state.script.refinedPrompt && !isSummaryGenerating
  const isUploadSource = state.script.source === 'upload'
  const sourceMaxLength = isUploadSource ? SHORT_DRAMA_ORIGINAL_SCRIPT_MAX_CHARS : ORIGINAL_PROMPT_MAX_LENGTH
  const sourceDraftLength = sourceEditDraft.trim().length
  const isSourceDraftTooLong = sourceDraftLength > sourceMaxLength
  const isOutlinesGenerating =
    generatingOutlines ||
    (
      state.script.status === 'generating' &&
      Boolean(state.script.refinedPrompt) &&
      state.script.outlines.length < state.settings.episodeCount
    )
  const isEditingSummary = Boolean(editingSummaryHeading || characterBioDialog)
  const summarySectionsForNavigation = state.script.refinedPrompt ? parseScriptSummary(state.script.refinedPrompt) : {}
  const hasCharacterBioNavigation = Boolean(
    summarySectionsForNavigation.人物小传 &&
    parseCharacterBios(summarySectionsForNavigation.人物小传).length > 0
  )
  const outlineNavigationGroups = buildEpisodeOutlineGroups(state.script.outlines)
  const hasOutlinesNavigation = state.script.outlines.length > 0
  const hasConfirmNavigation = !isLocked && state.script.outlines.length === state.settings.episodeCount
  const sourceLabel = state.script.source === 'upload' ? '原始剧本' : '原始创意'
  const sourceText = state.script.source === 'upload'
    ? state.script.originalScript
    : state.script.originalPrompt

  useEffect(() => {
    if (isEditingSummary) return
    setSummaryDraft(createSummaryDraft(state.script.refinedPrompt ?? '', state.settings.episodeCount))
  }, [isEditingSummary, state.script.refinedPrompt, state.settings.episodeCount])

  const handleGenerateSummary = async (triggeredBy: 'manual' = 'manual') => {
    if (generatingSummaryRef.current || state.script.status === 'generating' || state.script.refinedPrompt) return
    generatingSummaryRef.current = true
    setGeneratingSummary(true)
    setSummaryStreamText('')
    setStreamWarningMessage('')
    try {
      const result = await generateShortDramaScriptSummary(projectId, {
        onChunk: text => setSummaryStreamText(current => current + text),
        onProgress: progress => setOutlineProgressMessage(progress.message),
        onWarning: warning => setStreamWarningMessage(warning.message),
      })
      onStateChange()
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : '生成失败'

      toast.error(errorMessage)
    } finally {
      generatingSummaryRef.current = false
      setGeneratingSummary(false)
    }
  }

  const handleGenerateOutlines = async () => {
    if (
      generatingOutlinesRef.current ||
      state.script.status === 'generating' ||
      !state.script.refinedPrompt ||
      state.script.outlines.length >= state.settings.episodeCount
    ) return
    generatingOutlinesRef.current = true
    setGeneratingOutlines(true)
    setOutlineStreamText('')
    setOutlineProgressMessage('')
    setStreamWarningMessage('')
    try {
      const result = await generateShortDramaEpisodeOutlines(projectId, {
        onChunk: text => setOutlineStreamText(current => current + text),
        onProgress: progress => setOutlineProgressMessage(progress.message),
        onWarning: warning => setStreamWarningMessage(warning.message),
      })
      onStateChange()
      if (result.warning) setStreamWarningMessage(result.warning)
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : '生成失败'

      toast.error(errorMessage)
    } finally {
      generatingOutlinesRef.current = false
      setGeneratingOutlines(false)
    }
  }

  const handleEditSummaryHeading = (heading: SummaryHeading) => {
    setSummaryDraft(createSummaryDraft(state.script.refinedPrompt ?? '', state.settings.episodeCount))
    setEditingSummaryHeading(heading)
    setCharacterBioDialog(null)
  }

  const handleOpenSourceEdit = () => {
    if (!canEditSource) return
    const initial = isUploadSource ? state.script.originalScript : state.script.originalPrompt
    setSourceEditDraft(initial ?? '')
    setSourceEditOpen(true)
  }

  const handleCancelSourceEdit = () => {
    if (savingSourceEdit) return
    setSourceEditOpen(false)
  }

  const handleSaveSourceEdit = async () => {
    if (savingSourceEdit) return
    const trimmed = sourceEditDraft.trim()
    if (!trimmed) {
      toast.error(isUploadSource ? '原始剧本不能为空' : '原始创意不能为空')
      return
    }
    if (trimmed.length > sourceMaxLength) {
      toast.error(`内容不能超过 ${sourceMaxLength.toLocaleString()} 字`)
      return
    }
    setSavingSourceEdit(true)
    try {
      await updateShortDramaScriptSource(
        projectId,
        isUploadSource ? { originalScript: trimmed } : { originalPrompt: trimmed },
      )
      toast.success(isUploadSource ? '原始剧本已更新' : '原始创意已更新')
      setSourceEditOpen(false)
      onStateChange()
    } catch (error) {
      const message = error instanceof Error ? error.message : '保存失败，请稍后重试'
      toast.error(message)
    } finally {
      setSavingSourceEdit(false)
    }
  }

  const handleEditCharacterBio = (name: string) => {
    const nextDraft = createSummaryDraft(state.script.refinedPrompt ?? '', state.settings.episodeCount)
    const bio = parseCharacterBios(nextDraft.人物小传).find(item => item.name === name)
    setSummaryDraft(nextDraft)
    setCharacterBioDialog({
      mode: 'edit',
      originalName: name,
      name,
      fields: parseCharacterBioFields(bio?.body ?? ''),
    })
    setEditingSummaryHeading(null)
  }

  const handleChangeSummaryHeading = (heading: SummaryHeading, value: string) => {
    setSummaryDraft(current => ({ ...current, [heading]: value }))
  }

  const handleAddCharacterBio = () => {
    const nextDraft = createSummaryDraft(state.script.refinedPrompt ?? '', state.settings.episodeCount)
    const name = makeNewCharacterName(nextDraft.人物小传)
    setSummaryDraft(nextDraft)
    setCharacterBioDialog({
      mode: 'add',
      originalName: null,
      name,
      fields: createEmptyCharacterBioFields(),
    })
    setEditingSummaryHeading(null)
  }

  const handleCancelSummaryEdit = () => {
    setSummaryDraft(createSummaryDraft(state.script.refinedPrompt ?? '', state.settings.episodeCount))
    setEditingSummaryHeading(null)
    setCharacterBioDialog(null)
  }

  const saveSummaryDraft = async (successMessage: string, draftToSave = summaryDraft) => {
    const nextSummary = buildScriptSummary(draftToSave)
    if (!nextSummary) {
      toast.error('摘要不能为空')
      return
    }

    try {
      await saveShortDramaProject(projectId, {
        state: {
          ...state,
          script: {
            ...state.script,
            refinedPrompt: nextSummary,
          },
        },
      })
      setEditingSummaryHeading(null)
      setCharacterBioDialog(null)
      onStateChange()
      toast.success(successMessage)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存失败')
    }
  }

  const handleSaveSummaryHeading = async (heading: SummaryHeading) => {
    setSavingSummaryHeading(heading)
    try {
      await saveSummaryDraft(`${heading}已保存`)
    } finally {
      setSavingSummaryHeading(null)
    }
  }

  const handleSaveCharacterBio = async () => {
    if (!characterBioDialog) return
    const name = characterBioDialog.name.trim()
    const body = buildCharacterBioBody(characterBioDialog.fields)

    if (!name) {
      toast.error('人物名称不能为空')
      return
    }
    if (name.length > CHARACTER_NAME_MAX_LENGTH) {
      toast.error(`人物名称不能超过 ${CHARACTER_NAME_MAX_LENGTH} 字`)
      return
    }
    if (!body) {
      toast.error('人物小传不能为空')
      return
    }
    if (body.length > CHARACTER_BIO_MAX_LENGTH) {
      toast.error(`人物小传不能超过 ${CHARACTER_BIO_MAX_LENGTH} 字`)
      return
    }
    const oversizedField = CHARACTER_BIO_FIELDS.find(
      field => characterBioDialog.fields[field].length > CHARACTER_BIO_FIELD_LIMITS[field]
    )
    if (oversizedField) {
      toast.error(`${oversizedField}不能超过 ${CHARACTER_BIO_FIELD_LIMITS[oversizedField]} 字`)
      return
    }

    const existingNames = parseCharacterBios(summaryDraft.人物小传)
      .map(item => item.name)
      .filter(item => item !== characterBioDialog.originalName)
    if (existingNames.includes(name)) {
      toast.error('人物名称已存在')
      return
    }

    const nextDraft: SummaryDraft = {
      ...summaryDraft,
      人物小传: upsertCharacterBio(summaryDraft.人物小传, characterBioDialog.originalName, { name, body }),
    }
    setSummaryDraft(nextDraft)
    setSavingSummaryHeading('人物小传')
    try {
      await saveSummaryDraft(`${name}小传已保存`, nextDraft)
    } finally {
      setSavingSummaryHeading(null)
    }
  }

  const handleEditEpisodeTitle = (episodeNumber: number) => {
    const outline = state.script.outlines.find(item => item.episodeNumber === episodeNumber)
    if (!outline) return
    setEpisodeOutlineDialog({
      episodeNumber,
      mode: 'title',
      label: `第 ${episodeNumber} 集`,
      value: outline.title,
    })
  }

  const handleEditEpisodeScene = (episodeNumber: number, sceneIndex: number) => {
    const outline = state.script.outlines.find(item => item.episodeNumber === episodeNumber)
    if (!outline) return
    const scene = parseEpisodeSceneBlocks(outline.summary)[sceneIndex]
    if (!scene) return
    setEpisodeOutlineDialog({
      episodeNumber,
      mode: 'scene',
      sceneIndex,
      label: `第 ${episodeNumber} 集 · ${scene.heading}`,
      value: scene.body,
    })
  }

  const handleSaveEpisodeOutline = async () => {
    if (!episodeOutlineDialog) return
    const value = episodeOutlineDialog.value.trim()

    if (!value) {
      toast.error(episodeOutlineDialog.mode === 'title' ? '分集标题不能为空' : '分场内容不能为空')
      return
    }
    if (episodeOutlineDialog.mode === 'title' && value.length > EPISODE_TITLE_MAX_LENGTH) {
      toast.error(`分集标题不能超过 ${EPISODE_TITLE_MAX_LENGTH} 字`)
      return
    }
    if (episodeOutlineDialog.mode === 'scene' && value.length > EPISODE_SCENE_MAX_LENGTH) {
      toast.error(`分场内容不能超过 ${EPISODE_SCENE_MAX_LENGTH} 字`)
      return
    }

    const currentOutline = state.script.outlines.find(
      outline => outline.episodeNumber === episodeOutlineDialog.episodeNumber
    )
    if (!currentOutline) {
      toast.error('未找到对应分集')
      return
    }

    const nextTitle = episodeOutlineDialog.mode === 'title' ? value : currentOutline.title
    let nextSummary = currentOutline.summary

    if (episodeOutlineDialog.mode === 'scene') {
      const sceneBlocks = parseEpisodeSceneBlocks(currentOutline.summary)
      const sceneIndex = episodeOutlineDialog.sceneIndex ?? -1
      if (!sceneBlocks[sceneIndex]) {
        toast.error('未找到对应分场')
        return
      }
      sceneBlocks[sceneIndex] = {
        ...sceneBlocks[sceneIndex],
        body: value,
      }
      nextSummary = buildEpisodeSummaryFromBlocks(sceneBlocks)
    }

    const now = new Date().toISOString()
    const nextState: ShortDramaState = {
      ...state,
      script: {
        ...state.script,
        outlines: state.script.outlines.map(outline => (
          outline.episodeNumber === episodeOutlineDialog.episodeNumber
            ? { ...outline, title: nextTitle, summary: nextSummary }
            : outline
        )),
      },
      episodes: {
        ...state.episodes,
        items: state.episodes.items.map(episode => (
          episode.episodeNumber === episodeOutlineDialog.episodeNumber
            ? { ...episode, title: nextTitle, summary: nextSummary, updatedAt: now }
            : episode
        )),
      },
    }

    setSavingEpisodeOutline(true)
    try {
      await saveShortDramaProject(projectId, { state: nextState })
      setEpisodeOutlineDialog(null)
      onStateChange()
      toast.success(episodeOutlineDialog.mode === 'title' ? '分集标题已保存' : '分场剧本已保存')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSavingEpisodeOutline(false)
    }
  }

  const handleConfirm = async () => {
    setConfirming(true)
    try {
      await saveShortDramaProject(projectId, {
        state: {
          ...state,
          locks: { ...state.locks, script: true },
          steps: { active: 'assets', completed: [...state.steps.completed, 'script'] },
        },
      })
      onStateChange()
      toast.success('剧本已确认')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '确认失败')
    } finally {
      setConfirming(false)
    }
  }

  return (
    <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_112px]">
      <div className="min-w-0 space-y-6">
      <section id="short-drama-original" className="scroll-mt-24 space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="font-medium">{sourceLabel}</h3>
          {canEditSource && (
            <Button size="sm" variant="outline" onClick={handleOpenSourceEdit}>
              <Pencil className="w-3.5 h-3.5 mr-1" />
              编辑{sourceLabel}
            </Button>
          )}
        </div>
        <p className="max-h-[360px] overflow-y-auto rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground whitespace-pre-wrap">
          {sourceText || '（无）'}
        </p>
      </section>

      <section id="short-drama-summary" className="scroll-mt-24 space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="font-medium">剧本摘要</h3>
          {!isLocked && (
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => handleGenerateSummary('manual')} disabled={isSummaryGenerating || isEditingSummary}>
                {isSummaryGenerating ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Sparkles className="w-3.5 h-3.5 mr-1" />}
                {isSummaryGenerating ? '摘要生成中' : state.script.refinedPrompt ? '摘要已生成' : '生成摘要'}
              </Button>
            </div>
          )}
        </div>
        {state.script.refinedPrompt ? (
          <ScriptSummaryView
            value={state.script.refinedPrompt}
            draft={summaryDraft}
            canEdit={!isLocked}
            editingHeading={editingSummaryHeading}
            savingHeading={savingSummaryHeading}
            onEditHeading={handleEditSummaryHeading}
            onChangeHeading={handleChangeSummaryHeading}
            onSaveHeading={handleSaveSummaryHeading}
            onCancelEdit={handleCancelSummaryEdit}
            onEditCharacter={handleEditCharacterBio}
            onAddCharacter={handleAddCharacterBio}
          />
        ) : null}
        <CharacterBioDialog
          value={characterBioDialog}
          saving={savingSummaryHeading === '人物小传'}
          onChange={setCharacterBioDialog}
          onClose={handleCancelSummaryEdit}
          onSave={handleSaveCharacterBio}
        />
        {generatingSummary && typedSummaryStreamText && (
          <TypewriterStreamBlock
            value={typedSummaryStreamText}
            className="rounded-lg border border-violet-100 bg-violet-50/60 p-3 text-sm text-slate-700 whitespace-pre-wrap"
          />
        )}
        {!generatingSummary && isSummaryGenerating && (
          <div className="rounded-lg border border-violet-100 bg-violet-50/60 p-3 text-sm text-violet-800">
            摘要生成中，页面会自动刷新状态...
          </div>
        )}
      </section>

      <section id="short-drama-outlines" className="scroll-mt-24 space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="font-medium">分集剧本 ({state.script.outlines.length} 集)</h3>
          {!isLocked && state.script.refinedPrompt && (
            <Button size="sm" variant="outline" onClick={() => handleGenerateOutlines()} disabled={isOutlinesGenerating}>
              {isOutlinesGenerating ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Sparkles className="w-3.5 h-3.5 mr-1" />}
              {isOutlinesGenerating
                ? '剧本生成中'
                : state.script.outlines.length > 0 && state.script.outlines.length < state.settings.episodeCount
                ? '继续生成剧本'
                : '生成分集剧本'}
            </Button>
          )}
        </div>
        {streamWarningMessage && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            <div className="font-medium">生成已暂停</div>
            <p className="mt-1">{streamWarningMessage}</p>
            <p className="mt-1 text-xs">
              已生成 {state.script.outlines.length} / {state.settings.episodeCount} 集，可补充 A豆后继续生成剩余集数。
            </p>
          </div>
        )}

        {isOutlinesGenerating && (
          <div className="flex items-center gap-2 rounded-lg border border-violet-100 bg-violet-50/60 p-3 text-sm text-violet-800 dark:border-violet-900/60 dark:bg-violet-950/20 dark:text-violet-200">
            <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
            <span>{getCurrentOutlineProgressMessage(state, outlineProgressMessage)}</span>
          </div>
        )}

        {generatingOutlines && typedOutlineStreamText && (
          <TypewriterStreamBlock
            value={typedOutlineStreamText}
            className="max-h-48 overflow-y-auto rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground whitespace-pre-wrap"
          />
        )}
        {state.script.outlines.length > 0 && (
          <EpisodeOutlineList
            outlines={state.script.outlines}
            canEdit={!isLocked && !Boolean(episodeOutlineDialog)}
            onEditTitle={handleEditEpisodeTitle}
            onEditScene={handleEditEpisodeScene}
          />
        )}
        <EpisodeOutlineDialog
          value={episodeOutlineDialog}
          saving={savingEpisodeOutline}
          onChange={setEpisodeOutlineDialog}
          onClose={() => setEpisodeOutlineDialog(null)}
          onSave={handleSaveEpisodeOutline}
        />
      </section>

      {!isLocked && state.script.outlines.length === state.settings.episodeCount && (
        <Button id="short-drama-confirm" onClick={handleConfirm} disabled={confirming} className="w-full scroll-mt-24">
          {confirming ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Check className="w-4 h-4 mr-2" />}
          确认剧本，进入素材
        </Button>
      )}

      {isLocked && (
        <div className="text-center text-sm text-muted-foreground py-4">
          剧本已锁定确认
        </div>
      )}

      <Dialog
        open={sourceEditOpen}
        onOpenChange={open => {
          if (!open) handleCancelSourceEdit()
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>编辑{sourceLabel}</DialogTitle>
            <DialogDescription>
              修改后会替换当前{sourceLabel}，最多 {sourceMaxLength.toLocaleString()} 字。仅在摘要尚未生成时可编辑。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Textarea
              value={sourceEditDraft}
              onChange={event => setSourceEditDraft(event.target.value)}
              placeholder={isUploadSource ? '在这里粘贴或编辑原始剧本...' : '在这里编辑原始创意...'}
              className={`${isUploadSource ? 'min-h-[320px]' : 'min-h-[180px]'} resize-none rounded-lg border-border bg-muted/35 p-4 text-sm focus-visible:ring-primary/25 dark:border-[#201b49] dark:bg-[#070615]`}
              autoFocus
            />
            <div className="flex items-center justify-between gap-3 text-xs">
              <span className={isSourceDraftTooLong ? 'text-red-500' : 'text-muted-foreground'}>
                {sourceDraftLength.toLocaleString()} / {sourceMaxLength.toLocaleString()} 字
              </span>
              {isSourceDraftTooLong && (
                <span className="text-red-500">请精简后再保存</span>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={handleCancelSourceEdit} disabled={savingSourceEdit}>
              取消
            </Button>
            <Button
              onClick={handleSaveSourceEdit}
              disabled={savingSourceEdit || !sourceEditDraft.trim() || isSourceDraftTooLong}
            >
              {savingSourceEdit ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Save className="w-4 h-4 mr-1" />}
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </div>

      <aside className="-mr-8 hidden xl:block">
        <nav className="sticky top-10 space-y-2 rounded-lg border border-border/70 bg-card/80 p-2 text-xs shadow-sm dark:border-slate-800 dark:bg-slate-950/60">
          <div className="px-1.5 font-medium text-muted-foreground">导航</div>
          <div className="space-y-0.5">
            <div className="px-1.5 pt-1 text-[11px] font-medium text-foreground">剧本</div>
            <a
              href="#short-drama-original"
              className="block rounded-md px-3 py-1.5 text-muted-foreground transition hover:bg-muted/60 hover:text-foreground"
            >
              {sourceLabel}
            </a>
            <a
              href="#short-drama-summary"
              className="block rounded-md px-3 py-1.5 text-muted-foreground transition hover:bg-muted/60 hover:text-foreground"
            >
              剧本摘要
            </a>
            {hasCharacterBioNavigation && (
              <a
                href="#short-drama-character-bios"
                className="block rounded-md px-3 py-1.5 text-muted-foreground transition hover:bg-muted/60 hover:text-foreground"
              >
                人物小传
              </a>
            )}
          </div>
          {hasOutlinesNavigation && (
            <div className="space-y-0.5">
              <div className="px-1.5 pt-1 text-[11px] font-medium text-foreground">分集</div>
              {outlineNavigationGroups.map(group => (
                <a
                  key={group.id}
                  href={`#${group.id}`}
                  className="block rounded-md px-3 py-1.5 text-muted-foreground transition hover:bg-muted/60 hover:text-foreground"
                >
                  {group.label}
                </a>
              ))}
            </div>
          )}
          {hasConfirmNavigation && (
            <div className="space-y-0.5 border-t border-border/60 pt-1">
              <a
                href="#short-drama-confirm"
                className="block rounded-md px-1.5 py-1.5 text-muted-foreground transition hover:bg-muted/60 hover:text-foreground"
              >
                确认剧本
              </a>
            </div>
          )}
        </nav>
      </aside>
    </div>
  )
}
