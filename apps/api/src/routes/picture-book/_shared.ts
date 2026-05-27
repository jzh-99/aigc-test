import { getDb } from '@aigc/db'
import {
  PICTURE_BOOK_IMAGE_MODEL,
  PICTURE_BOOK_TEXT_MODEL,
  PICTURE_BOOK_TTS_MODEL,
  normalizePictureBookState,
  type PictureBookAssetKind,
} from '@aigc/types'
import { recordLlmProviderCall, type LlmProviderAuditContext } from '../../lib/provider-api-audit.js'

export const PICTURE_BOOK_MODELS = {
  text: PICTURE_BOOK_TEXT_MODEL,
  image: PICTURE_BOOK_IMAGE_MODEL,
  tts: PICTURE_BOOK_TTS_MODEL,
} as const

export function parsePictureBookJson(raw: string): any {
  const candidates = [
    ...Array.from(raw.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi), match => match[1]),
    raw,
  ]

  for (const candidate of candidates) {
    const objectText = extractFirstJsonObject(candidate)
    if (!objectText) continue

    try {
      const parsed = JSON.parse(objectText)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed
    } catch {
      // 尝试下一个候选片段。
    }
  }

  throw new Error('AI 返回格式错误，请重试')
}

export function validatePictureBookTargets(
  targets: Array<{ kind: PictureBookAssetKind; ref_id: string }>,
): void {
  if (!Array.isArray(targets) || targets.length === 0) {
    throw new Error('至少选择 1 个生成目标')
  }

  for (const target of targets) {
    if (!target?.kind) throw new Error('生成目标类型不能为空')
    if (!target.ref_id?.trim()) throw new Error('生成目标 ref_id 不能为空')
  }
}

export function calculateProjectChargeTotal(
  charges: Array<{ estimated_credits: number; actual_credits: number | null; status: string }>,
): { estimatedCredits: number; actualCredits: number } {
  return charges.reduce((total, charge) => {
    if (charge.status === 'failed' || charge.status === 'refunded') return total

    total.estimatedCredits += charge.estimated_credits
    total.actualCredits += charge.actual_credits ?? 0

    return total
  }, { estimatedCredits: 0, actualCredits: 0 })
}

export async function callPictureBookQwen(
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number,
  auditContext: Partial<LlmProviderAuditContext>,
): Promise<string> {
  const apiUrl = process.env.QWEN_API_URL ?? ''
  const apiKey = process.env.QWEN_API_KEY ?? ''
  const endpoint = '/chat/completions'
  const requestPayload = {
    model: PICTURE_BOOK_MODELS.text,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    stream: false,
    enable_thinking: true,
    max_tokens: maxTokens,
  }
  const startedAt = Date.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 180_000)

  try {
    const res = await fetch(`${apiUrl}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestPayload),
      signal: controller.signal,
    })

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      await recordLlmProviderCall({
        module: auditContext.module ?? 'picture-book',
        provider: 'qwen',
        model: PICTURE_BOOK_MODELS.text,
        operation: auditContext.operation ?? 'picture-book.qwen.generate',
        endpoint,
        userId: auditContext.userId,
        teamId: auditContext.teamId,
        workspaceId: auditContext.workspaceId,
        requestPayload,
        responseStatus: res.status,
        responsePayload: { body },
        durationMs: Date.now() - startedAt,
        status: 'failed',
        errorMessage: `Qwen HTTP ${res.status}: ${body.slice(0, 500)}`,
      })
      throw new Error(`Qwen HTTP ${res.status}`)
    }

    const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> }
    await recordLlmProviderCall({
      module: auditContext.module ?? 'picture-book',
      provider: 'qwen',
      model: PICTURE_BOOK_MODELS.text,
      operation: auditContext.operation ?? 'picture-book.qwen.generate',
      endpoint,
      userId: auditContext.userId,
      teamId: auditContext.teamId,
      workspaceId: auditContext.workspaceId,
      requestPayload,
      responseStatus: res.status,
      responsePayload: data,
      durationMs: Date.now() - startedAt,
      status: 'success',
    })

    return data.choices?.[0]?.message?.content?.replace(/<think>[\s\S]*?<\/think>/g, '').trim() ?? ''
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Qwen HTTP ')) throw error
    const message = error instanceof Error ? error.message : String(error)
    await recordLlmProviderCall({
      module: auditContext.module ?? 'picture-book',
      provider: 'qwen',
      model: PICTURE_BOOK_MODELS.text,
      operation: auditContext.operation ?? 'picture-book.qwen.generate',
      endpoint,
      userId: auditContext.userId,
      teamId: auditContext.teamId,
      workspaceId: auditContext.workspaceId,
      requestPayload,
      durationMs: Date.now() - startedAt,
      status: 'failed',
      errorMessage: message,
    })
    throw error
  } finally {
    clearTimeout(timer)
  }
}

export async function assertPictureBookWorkspaceAccess(
  workspaceId: string,
  userId: string,
  write = false,
) {
  const db = getDb()
  const member = await db
    .selectFrom('workspace_members')
    .innerJoin('workspaces', 'workspaces.id', 'workspace_members.workspace_id')
    .select([
      'workspace_members.workspace_id as workspaceId',
      'workspace_members.role',
      'workspaces.team_id as teamId',
    ])
    .where('workspace_members.workspace_id', '=', workspaceId)
    .where('workspace_members.user_id', '=', userId)
    .where('workspaces.is_deleted', '=', false)
    .executeTakeFirst()

  if (!member) return null
  if (write && member.role === 'viewer') return null

  return member
}

export async function assertPictureBookProjectAccess(
  projectId: string,
  userId: string,
  write = false,
) {
  const db = getDb()
  const access = await db
    .selectFrom('picture_book_projects')
    .innerJoin('workspaces', 'workspaces.id', 'picture_book_projects.workspace_id')
    .innerJoin('workspace_members', 'workspace_members.workspace_id', 'picture_book_projects.workspace_id')
    .select([
      'picture_book_projects.id',
      'picture_book_projects.workspace_id as workspaceId',
      'picture_book_projects.team_id as teamId',
      'picture_book_projects.user_id as ownerId',
      'picture_book_projects.title',
      'picture_book_projects.prompt',
      'picture_book_projects.style',
      'picture_book_projects.page_count as pageCount',
      'picture_book_projects.status',
      'picture_book_projects.active_step as activeStep',
      'picture_book_projects.cover_url as coverUrl',
      'picture_book_projects.state',
      'picture_book_projects.draft_saved_at as draftSavedAt',
      'picture_book_projects.estimated_credits as estimatedCredits',
      'picture_book_projects.actual_credits as actualCredits',
      'picture_book_projects.created_at as createdAt',
      'picture_book_projects.updated_at as updatedAt',
      'workspace_members.role',
    ])
    .where('picture_book_projects.id', '=', projectId)
    .where('picture_book_projects.is_deleted', '=', false)
    .where('workspaces.is_deleted', '=', false)
    .where('workspace_members.user_id', '=', userId)
    .executeTakeFirst()

  if (!access) return null
  if (write && access.role === 'viewer') return null

  return {
    ...access,
    state: normalizePictureBookState(access.state),
  }
}

function extractFirstJsonObject(raw: string): string | null {
  let start = -1
  let depth = 0
  let inString = false
  let escaped = false

  for (let i = 0; i < raw.length; i += 1) {
    const char = raw[i]

    if (start === -1) {
      if (char === '{') {
        start = i
        depth = 1
      }
      continue
    }

    if (escaped) {
      escaped = false
      continue
    }

    if (char === '\\') {
      escaped = inString
      continue
    }

    if (char === '"') {
      inString = !inString
      continue
    }

    if (inString) continue

    if (char === '{') depth += 1
    if (char === '}') depth -= 1

    if (depth === 0) return raw.slice(start, i + 1)
  }

  return null
}
