import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'
import { type PictureBookElement, type PictureBookPageScript } from '@aigc/types'
import { sql } from 'kysely'
import { assertPictureBookProjectAccess, callPictureBookQwen, parsePictureBookJson, PICTURE_BOOK_MODELS } from './_shared.js'

interface AssetPromptInput {
  style: string
  summaryZh: string
  pages: PictureBookPageScript[]
}

const DEFAULT_SYSTEM_PROMPT = [
  '你是儿童绘本角色和背景设定提示词专家。',
  '必须输出严格 JSON object，不要输出 Markdown。',
  '只生成提示词，不生成图片，不返回图片 URL。',
].join('\n')

export function buildAssetPromptUserPrompt(input: AssetPromptInput): string {
  return [
    `绘本风格：${input.style}`,
    `故事摘要：${input.summaryZh}`,
    '',
    '请从故事中提炼角色和背景，分别放入 characters 与 backgrounds。',
    '只生成提示词，用户会编辑后再批量生成图片。',
    '角色提示词建议包含：儿童绘本风格、所选风格、三视图、正面、侧面、背面、白底、全身照、角色设定图。',
    '背景提示词建议包含：儿童绘本风格、所选风格、场景设定图、全景、光线、氛围、空间元素。',
    '',
    '输出 JSON 格式：',
    '{',
    '  "characters": [{ "name": "角色名", "prompt": "角色提示词" }],',
    '  "backgrounds": [{ "name": "背景名", "prompt": "背景提示词" }]',
    '}',
    '',
    `分页内容：${JSON.stringify(input.pages)}`,
  ].join('\n')
}

function normalizeElements(items: unknown, prefix: 'character' | 'background'): PictureBookElement[] {
  if (!Array.isArray(items)) return []
  return items.map((item, index) => {
    const value = item && typeof item === 'object' ? item as Record<string, unknown> : {}
    return {
      id: `${prefix}_${index + 1}`,
      name: typeof value.name === 'string' && value.name.trim() ? value.name.trim() : `${prefix === 'character' ? '角色' : '背景'} ${index + 1}`,
      prompt: typeof value.prompt === 'string' ? value.prompt : '',
      imageUrl: null,
    }
  })
}

export function normalizeAssetPromptResult(raw: unknown): { characters: PictureBookElement[]; backgrounds: PictureBookElement[] } {
  const value = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  return {
    characters: normalizeElements(value.characters, 'character'),
    backgrounds: normalizeElements(value.backgrounds, 'background'),
  }
}

const route: FastifyPluginAsync = async (app) => {
  app.post<{ Body: { project_id: string } }>(
    '/picture-book/asset-prompts',
    {
      schema: {
        body: {
          type: 'object',
          required: ['project_id'],
          properties: { project_id: { type: 'string', format: 'uuid' } },
        },
      },
    },
    async (request, reply) => {
      const access = await assertPictureBookProjectAccess(request.body.project_id, request.user.id, true)
      if (!access) return reply.status(404).send({ error: { code: 'PROJECT_NOT_FOUND', message: '绘本项目不存在' } })

      try {
        const state = access.state
        const raw = await callPictureBookQwen(
          process.env.AI_PROMPT_PICTURE_BOOK_ASSETS ?? DEFAULT_SYSTEM_PROMPT,
          buildAssetPromptUserPrompt({
            style: access.style,
            summaryZh: state.script.summaryZh,
            pages: state.script.pages,
          }),
          8000,
          {
            userId: request.user.id,
            teamId: access.teamId,
            workspaceId: access.workspaceId,
            operation: 'picture-book.asset-prompts.generate',
          },
        )
        const result = normalizeAssetPromptResult(parsePictureBookJson(raw))
        const nextState = {
          ...state,
          steps: { active: 'assets' as const, completed: ['script' as const] },
          assets: result,
          draft: { dirty: false, savedAt: new Date().toISOString() },
        }

        await getDb()
          .updateTable('picture_book_projects')
          .set({
            state: JSON.stringify(nextState) as any,
            active_step: 'assets',
            status: 'script_ready',
            estimated_credits: sql`estimated_credits + 1`,
            actual_credits: sql`actual_credits + 1`,
            draft_saved_at: sql`now()`,
            updated_at: sql`now()`,
          })
          .where('id', '=', request.body.project_id)
          .execute()

        await getDb()
          .insertInto('picture_book_project_charges')
          .values({
            project_id: request.body.project_id,
            workspace_id: access.workspaceId,
            team_id: access.teamId,
            user_id: request.user.id,
            charge_type: 'project',
            model: PICTURE_BOOK_MODELS.text,
            target_count: result.characters.length + result.backgrounds.length,
            estimated_credits: 1,
            actual_credits: 1,
            status: 'completed',
            metadata: JSON.stringify({ operation: 'asset_prompts' }),
          })
          .execute()

        return reply.send({ success: true, assets: result, state: nextState })
      } catch (err) {
        app.log.error(err, 'picture-book asset prompts error')
        return reply.status(502).send({ success: false, error: { code: 'AI_ERROR', message: 'AI 服务暂时不可用，请稍后重试' } })
      }
    },
  )
}

export default route
