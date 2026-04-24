import type { FastifyInstance } from 'fastify'
import { getDb } from '@aigc/db'
import { sql } from 'kysely'

const SCRIPT_SYSTEM_PROMPT = `你是专业影视编剧。根据用户描述生成完整剧本。

输出严格遵循以下 JSON 格式，不输出任何其他内容：
{
  "title": "剧本标题",
  "script": "完整剧本正文（包含场景描述、对白、动作指示）",
  "characters": [
    { "name": "角色名", "description": "详细外貌描述，用于AI生图，包含发型、服装、面部特征等" }
  ],
  "scenes": [
    { "name": "场景名", "description": "详细视觉描述，用于AI生图，包含环境、光线、氛围等" }
  ]
}`

const STORYBOARD_SYSTEM_PROMPT = `你是专业影视分镜师，熟悉 Seedance/Seedream 视频生成模型的提示词规范。将剧本拆分为指定数量的分镜。

每个分镜必须包含以下所有字段，内容要具体、可执行：

- content：中文分镜描述，包含主体动作（表情、姿态、肢体）和场景背景（环境、时间、氛围）
- dialogue：本镜头的台词原文（中文，无台词则填空字符串 ""）
- characters：本镜头出现的角色名数组，必须从剧本提供的角色列表中选取，例如 ["李明", "王芳"]
- scene：本镜头所在场景名，必须从剧本提供的场景列表中选取，例如 "咖啡馆"
- cameraMove：运镜方式，从以下选择或组合：固定镜头、推进（zoom in）、拉远（zoom out）、横移（pan）、跟拍、俯拍、仰拍、手持抖动、环绕、第一视角
- duration：建议时长（秒），通常 4-8 秒

严格按以下 JSON 格式输出，不输出任何其他内容：
{
  "shots": [
    {
      "id": "shot_1",
      "label": "镜头1",
      "content": "中文分镜描述（动作+场景，不含台词）",
      "dialogue": "台词原文，无则为空字符串",
      "characters": ["角色名1"],
      "scene": "场景名",
      "cameraMove": "推进镜头",
      "duration": 5
    }
  ]
}`

const ASSET_PROMPT_SYSTEM_PROMPT = `你是专业AI提示词工程师。为角色和场景生成标准化的英文图片生成提示词。

要求：
1. 所有提示词共享同一风格锚点词（保证视觉一致性）
2. 角色提示词：详细描述外貌、服装、表情、姿势
3. 场景提示词：详细描述环境、光线、氛围、构图
4. 使用专业摄影/绘画术语
5. 每个提示词末尾加上风格词

严格按以下 JSON 格式输出，不输出任何其他内容：
{
  "styleAnchor": "统一风格词，如 cinematic, 4k, photorealistic",
  "characters": [
    { "name": "角色名", "prompt": "English image generation prompt" }
  ],
  "scenes": [
    { "name": "场景名", "prompt": "English image generation prompt" }
  ]
}`

const SERIES_OUTLINE_SYSTEM_PROMPT = `你是专业影视策划。根据用户描述生成系列剧集大纲。

输出严格遵循以下 JSON 格式，不输出任何其他内容：
{
  "title": "系列标题",
  "synopsis": "整体故事简介（200字以内）",
  "worldbuilding": "世界观设定",
  "mainCharacters": [
    { "name": "角色名", "description": "角色定位和外貌描述" }
  ],
  "episodes": [
    { "id": "ep_1", "title": "第1集标题", "synopsis": "本集故事简介（50字以内）" }
  ]
}`

export async function videoStudioRoutes(app: FastifyInstance) {
  const AI_API_URL = process.env.NANO_BANANA_API_URL ?? 'https://ai.comfly.chat'
  const AI_API_KEY = process.env.NANO_BANANA_API_KEY ?? ''
  const AI_MODEL = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash'

  async function callLLM(systemPrompt: string, userPrompt: string, maxTokens = 4000): Promise<string> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 90_000)
    try {
      const res = await fetch(`${AI_API_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${AI_API_KEY}` },
        body: JSON.stringify({
          model: AI_MODEL,
          messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
          stream: false,
          max_tokens: maxTokens,
        }),
        signal: controller.signal,
      })
      if (!res.ok) throw new Error(`LLM error ${res.status}`)
      const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> }
      return data.choices?.[0]?.message?.content ?? ''
    } finally {
      clearTimeout(timer)
    }
  }

  function parseJSON<T>(raw: string): T | null {
    try {
      const m = raw.match(/\{[\s\S]*\}/)
      if (!m) return null
      return JSON.parse(m[0]) as T
    } catch {
      return null
    }
  }

  // ── Script write ──────────────────────────────────────────────────────────────

  app.post<{
    Body: { description: string; style: string; duration: number; feedback?: string }
  }>(
    '/video-studio/script-write',
    {
      schema: {
        body: {
          type: 'object',
          required: ['description', 'style', 'duration'],
          properties: {
            description: { type: 'string', maxLength: 3000 },
            style: { type: 'string', maxLength: 200 },
            duration: { type: 'number', minimum: 10, maximum: 600 },
            feedback: { type: 'string', maxLength: 1000 },
          },
        },
      },
    },
    async (request, reply) => {
      const { description, style, duration, feedback } = request.body
      const shotCount = Math.ceil(duration / 10)
      let userPrompt = `风格：${style}\n目标时长：${duration}秒（约${shotCount}个镜头）\n\n故事描述：${description}`
      if (feedback) userPrompt += `\n\n修改意见：${feedback}`

      try {
        const raw = await callLLM(SCRIPT_SYSTEM_PROMPT, userPrompt, 6000)
        type ScriptResult = { title?: string; script?: string; characters?: Array<{ name: string; description: string }>; scenes?: Array<{ name: string; description: string }> }
        const parsed = parseJSON<ScriptResult>(raw)
        return reply.send({
          success: true,
          title: parsed?.title ?? '',
          script: parsed?.script ?? raw,
          characters: parsed?.characters ?? [],
          scenes: parsed?.scenes ?? [],
        })
      } catch (err) {
        app.log.error(err, 'video-studio script-write error')
        return reply.status(502).send({ success: false, error: { code: 'AI_ERROR', message: 'AI服务暂时不可用，请稍后重试' } })
      }
    },
  )

  // ── Storyboard split ──────────────────────────────────────────────────────────

  app.post<{
    Body: { script: string; shotCount: number; aspectRatio?: string; style?: string; characters?: Array<{ name: string; description: string }>; scenes?: Array<{ name: string; description: string }> }
  }>(
    '/video-studio/storyboard-split',
    {
      schema: {
        body: {
          type: 'object',
          required: ['script', 'shotCount'],
          properties: {
            script: { type: 'string', maxLength: 10000 },
            shotCount: { type: 'number', minimum: 0, maximum: 50 },
            aspectRatio: { type: 'string' },
            style: { type: 'string', maxLength: 200 },
            characters: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, description: { type: 'string' } } } },
            scenes: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, description: { type: 'string' } } } },
          },
        },
      },
    },
    async (request, reply) => {
      const { script, shotCount, aspectRatio, style, characters, scenes } = request.body
      const countInstruction = shotCount > 0 ? `分割成恰好 ${shotCount} 个分镜` : '根据剧本内容自动决定分镜数量（每个分镜约5-8秒）'
      const ratioNote = aspectRatio ? `\n画面比例：${aspectRatio}` : ''
      const styleNote = style ? `\n整体视觉风格：${style}` : ''
      const charList = characters?.length ? `\n\n可用角色列表（characters 字段只能从这里选取名字）：\n${characters.map(c => `- ${c.name}：${c.description}`).join('\n')}` : ''
      const sceneList = scenes?.length ? `\n\n可用场景列表（scene 字段只能从这里选取名字）：\n${scenes.map(s => `- ${s.name}：${s.description}`).join('\n')}` : ''
      const userPrompt = `请将以下剧本${countInstruction}${ratioNote}${styleNote}${charList}${sceneList}。\n\n每个分镜必须填写 characters（本镜头出现的角色）和 scene（所在场景），从上方列表中选取。\n\n剧本：\n\n${script}`

      try {
        const raw = await callLLM(STORYBOARD_SYSTEM_PROMPT, userPrompt, 8000)
        type ShotRaw = { id: string; label: string; content: string; dialogue?: string; characters?: string[]; scene?: string; cameraMove: string; duration: number }
        type StoryboardResult = { shots?: ShotRaw[] }
        const parsed = parseJSON<StoryboardResult>(raw)
        return reply.send({ success: true, shots: parsed?.shots ?? [] })
      } catch (err) {
        app.log.error(err, 'video-studio storyboard-split error')
        return reply.status(502).send({ success: false, error: { code: 'AI_ERROR', message: 'AI服务暂时不可用，请稍后重试' } })
      }
    },
  )

  // ── Asset prompts ─────────────────────────────────────────────────────────────

  app.post<{
    Body: {
      characters: Array<{ name: string; description: string }>
      scenes: Array<{ name: string; description: string }>
      style: string
    }
  }>(
    '/video-studio/asset-prompts',
    {
      schema: {
        body: {
          type: 'object',
          required: ['characters', 'scenes', 'style'],
          properties: {
            characters: { type: 'array', items: { type: 'object' } },
            scenes: { type: 'array', items: { type: 'object' } },
            style: { type: 'string', maxLength: 200 },
          },
        },
      },
    },
    async (request, reply) => {
      const { characters, scenes, style } = request.body
      const charList = characters.map((c) => `- ${c.name}：${c.description}`).join('\n')
      const sceneList = scenes.map((s) => `- ${s.name}：${s.description}`).join('\n')
      const userPrompt = `整体风格：${style}\n\n角色列表：\n${charList}\n\n场景列表：\n${sceneList}`

      try {
        const raw = await callLLM(ASSET_PROMPT_SYSTEM_PROMPT, userPrompt, 4000)
        type AssetResult = { styleAnchor?: string; characters?: Array<{ name: string; prompt: string }>; scenes?: Array<{ name: string; prompt: string }> }
        const parsed = parseJSON<AssetResult>(raw)
        return reply.send({
          success: true,
          styleAnchor: parsed?.styleAnchor ?? '',
          characters: parsed?.characters ?? [],
          scenes: parsed?.scenes ?? [],
        })
      } catch (err) {
        app.log.error(err, 'video-studio asset-prompts error')
        return reply.status(502).send({ success: false, error: { code: 'AI_ERROR', message: 'AI服务暂时不可用，请稍后重试' } })
      }
    },
  )

  // ── Series outline ────────────────────────────────────────────────────────────

  app.post<{
    Body: { description: string; style: string; episodeCount: number; episodeDuration: number }
  }>(
    '/video-studio/series-outline',
    {
      schema: {
        body: {
          type: 'object',
          required: ['description', 'style', 'episodeCount', 'episodeDuration'],
          properties: {
            description: { type: 'string', maxLength: 3000 },
            style: { type: 'string', maxLength: 200 },
            episodeCount: { type: 'number', minimum: 2, maximum: 50 },
            episodeDuration: { type: 'number', minimum: 10, maximum: 600 },
          },
        },
      },
    },
    async (request, reply) => {
      const { description, style, episodeCount, episodeDuration } = request.body
      const userPrompt = `风格：${style}\n集数：${episodeCount}集，每集约${episodeDuration}秒\n\n故事描述：${description}`

      try {
        const raw = await callLLM(SERIES_OUTLINE_SYSTEM_PROMPT, userPrompt, 6000)
        type SeriesResult = { title?: string; synopsis?: string; worldbuilding?: string; mainCharacters?: Array<{ name: string; description: string }>; episodes?: Array<{ id: string; title: string; synopsis: string }> }
        const parsed = parseJSON<SeriesResult>(raw)
        return reply.send({
          success: true,
          title: parsed?.title ?? '',
          synopsis: parsed?.synopsis ?? '',
          worldbuilding: parsed?.worldbuilding ?? '',
          mainCharacters: parsed?.mainCharacters ?? [],
          episodes: parsed?.episodes ?? [],
        })
      } catch (err) {
        app.log.error(err, 'video-studio series-outline error')
        return reply.status(502).send({ success: false, error: { code: 'AI_ERROR', message: 'AI服务暂时不可用，请稍后重试' } })
      }
    },
  )

  // ── Project CRUD ──────────────────────────────────────────────────────────────

  // GET /video-studio/projects?workspace_id=...
  app.get<{ Querystring: { workspace_id: string } }>(
    '/video-studio/projects',
    async (request, reply) => {
      const db = getDb()
      const userId = request.user.id
      const { workspace_id } = request.query
      if (!workspace_id) return reply.status(400).send({ error: 'workspace_id required' })

      const member = await db
        .selectFrom('workspace_members')
        .select('workspace_id')
        .where('workspace_id', '=', workspace_id)
        .where('user_id', '=', userId)
        .executeTakeFirst()
      if (!member) return reply.status(403).send({ error: 'forbidden' })

      const projects = await db
        .selectFrom('video_studio_projects')
        .select(['id', 'name', 'created_at', 'updated_at'])
        .where('workspace_id', '=', workspace_id)
        .where('user_id', '=', userId)
        .orderBy('updated_at', 'desc')
        .execute()

      return reply.send(projects)
    },
  )

  // GET /video-studio/projects/:id
  app.get<{ Params: { id: string } }>(
    '/video-studio/projects/:id',
    async (request, reply) => {
      const db = getDb()
      const userId = request.user.id
      const { id } = request.params

      const project = await db
        .selectFrom('video_studio_projects')
        .selectAll()
        .where('id', '=', id)
        .where('user_id', '=', userId)
        .executeTakeFirst()

      if (!project) return reply.status(404).send({ error: 'not found' })
      return reply.send(project)
    },
  )

  // PUT /video-studio/projects/:id — upsert (create or update)
  app.put<{
    Params: { id: string }
    Body: { workspace_id: string; name: string; wizard_state: unknown }
  }>(
    '/video-studio/projects/:id',
    {
      schema: {
        body: {
          type: 'object',
          required: ['workspace_id', 'name', 'wizard_state'],
          properties: {
            workspace_id: { type: 'string' },
            name: { type: 'string', maxLength: 200 },
            wizard_state: { type: 'object' },
          },
        },
      },
    },
    async (request, reply) => {
      const db = getDb()
      const userId = request.user.id
      const { id } = request.params
      const { workspace_id, name, wizard_state } = request.body

      const member = await db
        .selectFrom('workspace_members')
        .select('workspace_id')
        .where('workspace_id', '=', workspace_id)
        .where('user_id', '=', userId)
        .executeTakeFirst()
      if (!member) return reply.status(403).send({ error: 'forbidden' })

      await db
        .insertInto('video_studio_projects')
        .values({
          id,
          workspace_id,
          user_id: userId,
          name,
          wizard_state: JSON.stringify(wizard_state),
        })
        .onConflict((oc) =>
          oc.column('id').doUpdateSet({
            name,
            wizard_state: JSON.stringify(wizard_state) as any,
            updated_at: sql`now()`,
          }),
        )
        .execute()

      return reply.send({ success: true })
    },
  )

  // DELETE /video-studio/projects/:id
  app.delete<{ Params: { id: string } }>(
    '/video-studio/projects/:id',
    async (request, reply) => {
      const db = getDb()
      const userId = request.user.id
      const { id } = request.params

      await db
        .deleteFrom('video_studio_projects')
        .where('id', '=', id)
        .where('user_id', '=', userId)
        .execute()

      return reply.send({ success: true })
    },
  )
}
