import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'
import {
  isPictureBookPageCount,
  isPictureBookStyle,
  makeDefaultPictureBookState,
  type PictureBookPageCount,
  type PictureBookPageScript,
  type PictureBookState,
  type PictureBookStyle,
} from '@aigc/types'
import { randomUUID } from 'node:crypto'
import { sql } from 'kysely'
import { assertPictureBookWorkspaceAccess, callPictureBookQwen, parsePictureBookJson, PICTURE_BOOK_MODELS } from './_shared.js'

interface ScriptBody {
  workspace_id: string
  prompt: string
  style: PictureBookStyle
  page_count: PictureBookPageCount
  title?: string
}

interface ScriptResult {
  title: string
  summaryZh: string
  pages: PictureBookPageScript[]
}

const DEFAULT_SYSTEM_PROMPT = [
  '你是儿童 AI 绘本剧本策划师。',
  '必须输出严格 JSON object，不要输出 Markdown。',
  '故事摘要只输出中文。',
  '每一页要有画面描述 visualPrompt，以及台词/旁白的中英双语版本。',
].join('\n')

export function buildScriptUserPrompt(input: { prompt: string; style: string; pageCount: number }): string {
  return [
    `绘本主题：${input.prompt}`,
    `绘本风格：${input.style}`,
    `页数：${input.pageCount} 页`,
    '',
    '请生成适合儿童绘本的剧本大纲。',
    '故事摘要只输出中文，不要提供英文摘要。',
    '脚本结构不区分中英文；只有 dialogue 和 narration 需要中英双语。',
    '每页必须填写 narration.zh、narration.en、dialogue.zh、dialogue.en 四个字段。',
    '',
    '输出 JSON 格式：',
    '{',
    '  "title": "绘本标题",',
    '  "summaryZh": "中文故事摘要",',
    '  "pages": [',
    '    {',
    '      "page": 1,',
    '      "visualPrompt": "这一页的画面描述",',
    '      "narration": { "zh": "中文旁白", "en": "English narration" },',
    '      "dialogue": { "zh": "中文台词", "en": "English dialogue" }',
    '    }',
    '  ]',
    '}',
  ].join('\n')
}

function readLocalized(value: unknown): { zh: string; en: string } {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  return {
    zh: typeof record.zh === 'string' ? record.zh : '',
    en: typeof record.en === 'string' ? record.en : '',
  }
}

export function normalizeScriptResult(raw: unknown, pageCount: number): ScriptResult {
  const value = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  const rawPages = Array.isArray(value.pages) ? value.pages : []
  const pages = Array.from({ length: pageCount }, (_, index) => {
    const page = rawPages[index] && typeof rawPages[index] === 'object' ? rawPages[index] as Record<string, unknown> : {}
    return {
      page: index + 1,
      narration: readLocalized(page.narration),
      dialogue: readLocalized(page.dialogue),
      visualPrompt: typeof page.visualPrompt === 'string' ? page.visualPrompt : '',
    }
  })

  return {
    title: typeof value.title === 'string' && value.title.trim() ? value.title.trim() : '未命名绘本',
    summaryZh: typeof value.summaryZh === 'string' ? value.summaryZh : '',
    pages,
  }
}

const route: FastifyPluginAsync = async (app) => {
  app.post<{ Body: ScriptBody }>(
    '/picture-book/script',
    {
      schema: {
        body: {
          type: 'object',
          required: ['workspace_id', 'prompt', 'style', 'page_count'],
          properties: {
            workspace_id: { type: 'string', format: 'uuid' },
            prompt: { type: 'string', minLength: 1, maxLength: 3000 },
            style: { type: 'string' },
            page_count: { type: 'number', enum: [10, 15, 20] },
            title: { type: 'string', maxLength: 200 },
          },
        },
      },
    },
    async (request, reply) => {
      const body = request.body
      if (!isPictureBookStyle(body.style)) return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: '绘本风格不支持' } })
      if (!isPictureBookPageCount(body.page_count)) return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: '页数不支持' } })

      const access = await assertPictureBookWorkspaceAccess(body.workspace_id, request.user.id, true)
      if (!access) return reply.status(403).send({ error: { code: 'FORBIDDEN', message: '无权修改该工作区' } })

      try {
        const raw = await callPictureBookQwen(
          process.env.AI_PROMPT_PICTURE_BOOK_SCRIPT ?? DEFAULT_SYSTEM_PROMPT,
          buildScriptUserPrompt({ prompt: body.prompt, style: body.style, pageCount: body.page_count }),
          12000,
          {
            userId: request.user.id,
            teamId: access.teamId,
            workspaceId: body.workspace_id,
            operation: 'picture-book.script.generate',
          },
        )
        const result = normalizeScriptResult(parsePictureBookJson(raw), body.page_count)
        const state: PictureBookState = {
          ...makeDefaultPictureBookState({ style: body.style, pageCount: body.page_count }),
          steps: { active: 'script', completed: ['script'] },
          script: { summaryZh: result.summaryZh, pages: result.pages },
          draft: { dirty: false, savedAt: new Date().toISOString() },
        }
        const projectId = randomUUID()

        await getDb()
          .insertInto('picture_book_projects')
          .values({
            id: projectId,
            workspace_id: body.workspace_id,
            team_id: access.teamId,
            user_id: request.user.id,
            title: body.title?.trim() || result.title,
            prompt: body.prompt,
            style: body.style,
            page_count: body.page_count,
            status: 'script_ready',
            active_step: 'script',
            state: JSON.stringify(state),
            estimated_credits: 1,
            actual_credits: 1,
            draft_saved_at: sql`now()`,
          })
          .execute()

        await getDb()
          .insertInto('picture_book_project_charges')
          .values({
            project_id: projectId,
            workspace_id: body.workspace_id,
            team_id: access.teamId,
            user_id: request.user.id,
            charge_type: 'project',
            model: PICTURE_BOOK_MODELS.text,
            target_count: 1,
            estimated_credits: 1,
            actual_credits: 1,
            status: 'completed',
            metadata: JSON.stringify({ operation: 'script_generate' }),
          })
          .execute()

        return reply.send({ success: true, projectId, title: result.title, state })
      } catch (err) {
        app.log.error(err, 'picture-book script generate error')
        return reply.status(502).send({ success: false, error: { code: 'AI_ERROR', message: 'AI 服务暂时不可用，请稍后重试' } })
      }
    },
  )
}

export default route
