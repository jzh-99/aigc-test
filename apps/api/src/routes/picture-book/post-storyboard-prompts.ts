import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'
import { type PictureBookElement, type PictureBookPageScript, type PictureBookStoryboardPage } from '@aigc/types'
import { sql } from 'kysely'
import { assertPictureBookProjectAccess, callPictureBookQwenStream, parsePictureBookJson, PICTURE_BOOK_MODELS } from './_shared.js'

interface StoryboardPromptInput {
  style: string
  pages: PictureBookPageScript[]
  characters: PictureBookElement[]
  backgrounds: PictureBookElement[]
}

const DEFAULT_SYSTEM_PROMPT = [
  '你是儿童绘本分镜提示词和双语语音脚本专家。',
  '必须输出严格 JSON object，不要输出 Markdown。',
  '脚本不区分中英文；只有台词/旁白、语音文案需要中英双语。',
  'imagePrompt 必须使用简体中文，不要输出英文画面提示词；风格、构图、光影、氛围等描述也必须写中文。',
  'imagePrompt 必须在需要引用资产时使用 @角色名 / @背景名 字面量，例如 @小狗、@森林。',
  '@ 引用只允许出现在 imagePrompt 中，audioText.zh 和 audioText.en 禁止出现 @ 标记。',
  '如果角色或背景列表为空，不要虚构 @ 标记。',
].join('\n')

export function buildStoryboardPromptUserPrompt(input: StoryboardPromptInput): string {
  return [
    `绘本风格：${input.style}`,
    '',
    '请为每一页生成图片提示词 imagePrompt，以及用于语音合成的 audioText.zh 和 audioText.en。',
    'imagePrompt 必须全程使用简体中文，可保留 @角色名 / @背景名 引用标记，但不要写英文单词、英文短语或英文绘图提示词。',
    'imagePrompt 中的绘本风格、主体、动作、场景、构图、材质、光影、色彩、氛围都必须用中文描述。',
    'imagePrompt 要参考角色和背景设定，保持整本绘本一致性。',
    '当画面出现某个角色或背景时，必须直接写入对应资产名称的 @ 标记，例如 @角色名 或 @背景名。',
    '只在 imagePrompt 中使用 @ 标记；audioText.zh 与 audioText.en 不使用 @ 标记。',
    'audioText.zh 与 audioText.en 来自该页旁白和台词，不要改变页数。',
    '',
    '输出 JSON 格式：',
    '{',
    '  "pages": [{',
    '    "page": 1,',
    '    "imagePrompt": "中文画面提示词，可包含 @角色名 或 @背景名 引用",',
    '    "audioText": { "zh": "中文语音文本", "en": "English audio text" }',
    '  }]',
    '}',
    '',
    `可引用角色名称：${input.characters.map(item => `@${item.name}`).join('、') || '无'}`,
    `可引用背景名称：${input.backgrounds.map(item => `@${item.name}`).join('、') || '无'}`,
    `角色：${JSON.stringify(input.characters)}`,
    `背景：${JSON.stringify(input.backgrounds)}`,
    `分页脚本：${JSON.stringify(input.pages)}`,
  ].join('\n')
}

function readLocalized(value: unknown): { zh: string; en: string } {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  return {
    zh: typeof record.zh === 'string' ? record.zh : '',
    en: typeof record.en === 'string' ? record.en : '',
  }
}

export function normalizeStoryboardPromptResult(raw: unknown, scripts: PictureBookPageScript[]): PictureBookStoryboardPage[] {
  const value = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  const rawPages = Array.isArray(value.pages) ? value.pages : []

  return scripts.map((script, index) => {
    const page = rawPages[index] && typeof rawPages[index] === 'object' ? rawPages[index] as Record<string, unknown> : {}
    const audioText = readLocalized(page.audioText)
    return {
      page: script.page || index + 1,
      script: {
        ...script,
        narration: {
          zh: audioText.zh || script.narration.zh,
          en: audioText.en || script.narration.en,
        },
      },
      prompt: typeof page.imagePrompt === 'string' ? page.imagePrompt : script.visualPrompt ?? '',
      imageUrl: null,
      voice: {
        zh: null,
        en: null,
      },
      status: 'idle',
    }
  })
}

const route: FastifyPluginAsync = async (app) => {
  app.post<{ Body: { project_id: string } }>(
    '/picture-book/storyboard-prompts',
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

      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      })
      reply.hijack()
      reply.raw.write(': connected\n\n')

      const sendEvent = (event: string, data: unknown) => {
        reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
      }

      const sendPing = () => {
        reply.raw.write(': ping\n\n')
      }

      try {
        const state = access.state
        const fullText = await callPictureBookQwenStream(
          process.env.AI_PROMPT_PICTURE_BOOK_STORYBOARD ?? DEFAULT_SYSTEM_PROMPT,
          buildStoryboardPromptUserPrompt({
            style: access.style,
            pages: state.script.pages,
            characters: state.assets.characters,
            backgrounds: state.assets.backgrounds,
          }),
          12000,
          {
            userId: request.user.id,
            teamId: access.teamId,
            workspaceId: access.workspaceId,
            operation: 'picture-book.storyboard-prompts.generate',
          },
          {
            onChunk: (text) => sendEvent('chunk', { text }),
            onThinking: () => sendPing(),
            onDone: () => {},
            onError: () => {},
          },
        )

        const storyboard = normalizeStoryboardPromptResult(parsePictureBookJson(fullText), state.script.pages)
        const nextState = {
          ...state,
          steps: { active: 'storyboard' as const, completed: ['script' as const, 'assets' as const] },
          storyboard,
          draft: { dirty: false, savedAt: new Date().toISOString() },
        }

        await getDb()
          .updateTable('picture_book_projects')
          .set({
            state: JSON.stringify(nextState) as any,
            active_step: 'storyboard',
            status: 'assets_ready',
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
            target_count: storyboard.length,
            estimated_credits: 1,
            actual_credits: 1,
            status: 'completed',
            metadata: JSON.stringify({ operation: 'storyboard_prompts' }),
          })
          .execute()

        sendEvent('done', { success: true, storyboard, state: nextState })
      } catch (err) {
        app.log.error(err, 'picture-book storyboard prompts error')
        sendEvent('error', { code: 'AI_ERROR', message: 'AI 服务暂时不可用，请稍后重试' })
      } finally {
        reply.raw.end()
      }
    },
  )
}

export default route
