'use client'

import { useEffect, useState } from 'react'
import { Loader2, Sparkles, Check, Pencil, Save, X, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { ShortDramaState } from '@aigc/types'
import {
  generateShortDramaScriptSummary,
  generateShortDramaEpisodeOutlines,
  saveShortDramaProject,
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
      <SummaryTextBlock title="导演阐述" heading="导演阐述" value={sections.导演阐述} canEdit={canStartEdit} editing={editingHeading === '导演阐述'} saving={savingHeading === '导演阐述'} draftValue={draft.导演阐述} onEdit={onEditHeading} onChange={onChangeHeading} onSave={onSaveHeading} onCancel={onCancelEdit} />
      <SummaryTextBlock title="影像风格" heading="影像风格" value={sections.影像风格} canEdit={canStartEdit} editing={editingHeading === '影像风格'} saving={savingHeading === '影像风格'} draftValue={draft.影像风格} onEdit={onEditHeading} onChange={onChangeHeading} onSave={onSaveHeading} onCancel={onCancelEdit} />
      <SummaryTextBlock title="妆造方向" heading="妆造方向" value={sections.妆造方向} canEdit={canStartEdit} editing={editingHeading === '妆造方向'} saving={savingHeading === '妆造方向'} draftValue={draft.妆造方向} onEdit={onEditHeading} onChange={onChangeHeading} onSave={onSaveHeading} onCancel={onCancelEdit} />
      <SummaryTextBlock title="核心场景与布景" heading="核心场景与布景" value={sections.核心场景与布景} canEdit={canStartEdit} editing={editingHeading === '核心场景与布景'} saving={savingHeading === '核心场景与布景'} draftValue={draft.核心场景与布景} onEdit={onEditHeading} onChange={onChangeHeading} onSave={onSaveHeading} onCancel={onCancelEdit} />
      <SummaryTextBlock title="灯光气质" heading="灯光气质" value={sections.灯光气质} canEdit={canStartEdit} editing={editingHeading === '灯光气质'} saving={savingHeading === '灯光气质'} draftValue={draft.灯光气质} onEdit={onEditHeading} onChange={onChangeHeading} onSave={onSaveHeading} onCancel={onCancelEdit} />
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
  return (
    <div className="space-y-3">
      {outlines.map(outline => {
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
  )
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
  const typedSummaryStreamText = useTypewriterText(summaryStreamText, generatingSummary)
  const typedOutlineStreamText = useTypewriterText(outlineStreamText, generatingOutlines)
  const isLocked = state.locks.script
  const isSummaryGenerating = generatingSummary || (state.script.status === 'generating' && !state.script.refinedPrompt)
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
  const hasOutlinesNavigation = state.script.outlines.length > 0
  const hasConfirmNavigation = !isLocked && state.script.outlines.length === state.settings.episodeCount

  useEffect(() => {
    if (isEditingSummary) return
    setSummaryDraft(createSummaryDraft(state.script.refinedPrompt ?? '', state.settings.episodeCount))
  }, [isEditingSummary, state.script.refinedPrompt, state.settings.episodeCount])

  // 自动触发剧本摘要生成
  useEffect(() => {
    if (isLocked || generatingSummary || isEditingSummary) return
    if (state.script.refinedPrompt) return // 已有摘要
    if (state.script.status === 'generating') return // 正在生成中

    void handleGenerateSummary('auto')
  }, [isLocked, generatingSummary, isEditingSummary, state.script.refinedPrompt, state.script.status])

  // 自动触发分集大纲生成
  useEffect(() => {
    if (isLocked || generatingOutlines) return
    if (!state.script.refinedPrompt) return // 摘要未生成
    if (state.script.outlines.length >= state.settings.episodeCount) return // 已完成所有集
    if (state.script.status === 'generating' && state.script.outlines.length > 0) return // 正在生成中

    void handleGenerateOutlines('auto')
  }, [isLocked, generatingOutlines, state.script.refinedPrompt, state.script.outlines.length, state.settings.episodeCount, state.script.status])

  const handleGenerateSummary = async (triggeredBy: 'auto' | 'manual' = 'auto') => {
    setGeneratingSummary(true)
    setSummaryStreamText('')
    setStreamWarningMessage('')
    try {
      await generateShortDramaScriptSummary(projectId)
      toast.success('已提交剧本摘要生成')
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : '生成失败'

      // 自动触发且任务已在进行中，静默处理
      if (triggeredBy === 'auto' && (errorMessage.includes('未完成') || errorMessage.includes('进行中'))) {
        console.info('剧本摘要生成任务已在进行中，等待完成')
        return
      }

      toast.error(errorMessage)
    } finally {
      setGeneratingSummary(false)
    }
  }

  const handleGenerateOutlines = async (triggeredBy: 'auto' | 'manual' = 'auto') => {
    setGeneratingOutlines(true)
    setOutlineStreamText('')
    setOutlineProgressMessage('')
    setStreamWarningMessage('')
    try {
      await generateShortDramaEpisodeOutlines(projectId)
      toast.success('已提交分集大纲生成')
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : '生成失败'

      // 自动触发且任务已在进行中，静默处理
      if (triggeredBy === 'auto' && (errorMessage.includes('未完成') || errorMessage.includes('进行中'))) {
        console.info('分集大纲生成任务已在进行中，等待完成')
        return
      }

      toast.error(errorMessage)
    } finally {
      setGeneratingOutlines(false)
    }
  }

  const handleEditSummaryHeading = (heading: SummaryHeading) => {
    setSummaryDraft(createSummaryDraft(state.script.refinedPrompt ?? '', state.settings.episodeCount))
    setEditingSummaryHeading(heading)
    setCharacterBioDialog(null)
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
        <h3 className="font-medium">原始创意</h3>
        <p className="rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">
          {state.script.originalPrompt || '（无）'}
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
            <Button size="sm" variant="outline" onClick={() => handleGenerateOutlines('manual')} disabled={isOutlinesGenerating}>
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

        {generatingOutlines && outlineProgressMessage && (
          <div className="rounded-lg border border-violet-100 bg-violet-50/60 p-3 text-sm text-violet-800">
            {outlineProgressMessage}
          </div>
        )}
        {!generatingOutlines && isOutlinesGenerating && (
          <div className="rounded-lg border border-violet-100 bg-violet-50/60 p-3 text-sm text-violet-800">
            大纲生成中，页面会自动刷新状态...
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
              原始创意
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
              <a
                href="#short-drama-outlines"
                className="block rounded-md px-3 py-1.5 text-muted-foreground transition hover:bg-muted/60 hover:text-foreground"
              >
                分集剧本
              </a>
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
