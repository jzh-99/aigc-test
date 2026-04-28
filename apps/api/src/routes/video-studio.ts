import type { FastifyInstance } from 'fastify'
import { getDb } from '@aigc/db'
import { sql } from 'kysely'
import { signAssetUrl } from '../lib/storage.js'
import { purgeVideoStudioProject, restoreProjectAssets, softDeleteProjectAssets } from '../lib/project-purge.js'

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

const STORYBOARD_SYSTEM_PROMPT = `你是专业影视分镜师，精通 Seedance 2.0 视频生成模型的提示词规范。将剧本拆分为指定数量的分镜，并为每个分镜生成可直接用于 Seedance 2.0 的中文提示词。

【visualPrompt 写作规范】遵循 主体 + 动作 + 场景 + 光影 + 风格 + 画质约束 结构：
- 主体：用 [角色名] 或 [场景名] 占位符指代，例如 [李明]、[咖啡馆]。前端会自动替换为正确的图编号。
- 动作：使用副词修饰，描述过程而非结果（"嘴角缓缓上扬，露出自然微笑"而非"微笑"）
- 台词：直接写在动作描述中，格式为：[角色名]说："台词内容"
- 运镜：必须写在 visualPrompt 里，每镜只用1-2种，包含景别+运动方式+速度，如"镜头从全景缓慢推进至中景，稳定运镜无抖动"
- 结尾必须加：画面稳定流畅，面部清晰不变形，人体结构正常，无文字伪影，无多余手指

每个分镜字段说明：
- content：中文分镜描述（动作+场景，台词也写在这里）
- characters：本镜头出现的角色名数组，从角色列表中选取
- scene：所在场景名，从场景列表中选取
- cameraMove：运镜方式简短描述（用于 UI 展示，如"缓慢推进至中景"）
- duration：建议时长（秒），4-8 秒
- visualPrompt：传给 Seedance 2.0 的完整中文提示词，包含主体、动作、台词、场景、光影、运镜、风格、画质约束全部信息，用 [角色名]/[场景名] 占位

严格按以下 JSON 格式输出，不输出任何其他内容：
{
  "shots": [
    {
      "id": "shot_1",
      "label": "镜头1",
      "content": "[李明]站在咖啡馆门口，缓缓转身，说：'你来了。'[王芳]从画面左侧走入。",
      "characters": ["李明", "王芳"],
      "scene": "咖啡馆",
      "cameraMove": "缓慢推进至中景",
      "duration": 5,
      "visualPrompt": "[李明]站在[咖啡馆]门口，缓缓转身，嘴角上扬说：'你来了。'[王芳]从画面左侧轻盈走入，步伐自然。暖黄色室内光，侧逆光勾勒轮廓。镜头从全景缓慢推进至中景，稳定运镜无抖动。电影感，治愈清新风格，4K超高清，细节丰富。画面稳定流畅，面部清晰不变形，人体结构正常，无文字伪影，无多余手指。视频需要有台词和音效，不要有字幕和bgm。"
    }
  ]
}`

const ASSET_PROMPT_SYSTEM_PROMPT = `你是专业AI图片生成提示词工程师。为角色和场景生成标准化的中文图片生成提示词，用于 Seedream 模型。

要求：
1. 所有提示词共享同一风格锚点（保证视觉一致性），风格锚点写在每条提示词末尾
2. 角色提示词：详细描述外貌（发型、发色、脸型、五官）、服装（颜色、款式、材质）、表情、姿势、光线
3. 场景提示词：详细描述环境、光线、氛围、构图、色调
4. 使用专业摄影术语（如：侧逆光、浅景深、中景构图）
5. 结尾加画质约束：4K超高清，细节丰富，无变形，无文字伪影

严格按以下 JSON 格式输出，不输出任何其他内容：
{
  "styleAnchor": "统一风格描述，如：电影感，治愈清新，4K超高清，写实风格",
  "characters": [
    { "name": "角色名", "prompt": "中文图片生成提示词" }
  ],
  "scenes": [
    { "name": "场景名", "prompt": "中文图片生成提示词" }
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

  async function assertProjectAccess(projectId: string, userId: string, requireDelete = false) {
    const db = getDb()
    const project = await db
      .selectFrom('video_studio_projects')
      .select(['workspace_id', 'user_id'])
      .where('id', '=', projectId)
      .executeTakeFirst()
    if (!project) return null

    const member = await db
      .selectFrom('workspace_members')
      .select('role')
      .where('workspace_id', '=', project.workspace_id)
      .where('user_id', '=', userId)
      .executeTakeFirst()
    if (!member) return null
    if (requireDelete && project.user_id !== userId && member.role !== 'admin') return null
    return { project, member }
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
      const userPrompt = `请将以下剧本${countInstruction}${ratioNote}${styleNote}${charList}${sceneList}。\n\n每个分镜必须填写 characters（本镜头出现的角色）和 scene（所在场景），从上方列表中选取。台词直接写在 content 和 visualPrompt 里，不要单独列出。\n\n剧本：\n\n${script}`

      try {
        const raw = await callLLM(STORYBOARD_SYSTEM_PROMPT, userPrompt, 8000)
        type ShotRaw = { id: string; label: string; content: string; characters?: string[]; scene?: string; cameraMove: string; duration: number; visualPrompt?: string }
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
        .where('is_deleted', '=', false)
        .where((eb) => eb.or([
          eb('user_id', '=', userId),
          eb.exists(db
            .selectFrom('workspace_members')
            .select('workspace_id')
            .where('workspace_id', '=', workspace_id)
            .where('user_id', '=', userId)
            .where('role', '=', 'admin')),
        ]))
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
        .where('is_deleted', '=', false)
        .executeTakeFirst()

      if (!project) return reply.status(404).send({ error: 'not found' })
      const member = await db
        .selectFrom('workspace_members')
        .select('workspace_id')
        .where('workspace_id', '=', project.workspace_id)
        .where('user_id', '=', userId)
        .executeTakeFirst()
      if (!member) return reply.status(403).send({ error: 'forbidden' })
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

      const existing = await db
        .selectFrom('video_studio_projects')
        .select(['workspace_id', 'is_deleted'])
        .where('id', '=', id)
        .executeTakeFirst()
      if (existing?.is_deleted) return reply.status(404).send({ error: 'not found' })

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

  // GET /video-studio/projects/:id/history
  app.get<{
    Params: { id: string }
    Querystring: { limit?: string; cursor?: string }
  }>('/video-studio/projects/:id/history', async (request, reply) => {
    const db = getDb()
    const { id } = request.params
    const limitN = Math.min(parseInt(request.query.limit ?? '30', 10) || 30, 100)
    const cursor = request.query.cursor

    const access = await assertProjectAccess(id, request.user.id)
    if (!access) return reply.status(404).send({ error: 'not found' })

    let decodedCursor: { created_at: string; id: string } | null = null
    if (cursor) {
      try { decodedCursor = JSON.parse(Buffer.from(cursor, 'base64').toString('utf-8')) }
      catch { return reply.badRequest('Invalid cursor') }
    }

    let query = db
      .selectFrom('task_batches')
      .select(['id', 'model', 'prompt', 'quantity', 'completed_count', 'failed_count', 'status', 'actual_credits', 'created_at', 'module', 'provider'])
      .where('video_studio_project_id', '=', id)
      .where('is_deleted', '=', false)
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .limit(limitN + 1) as any

    if (decodedCursor) {
      query = query.where((eb: any) => eb.or([
        eb('created_at', '<', decodedCursor!.created_at),
        eb.and([eb('created_at', '=', decodedCursor!.created_at), eb('id', '<', decodedCursor!.id)]),
      ]))
    }

    const rows = await query.execute()
    const hasMore = rows.length > limitN
    const items = await Promise.all((hasMore ? rows.slice(0, limitN) : rows).map(async (batch: any) => {
      const queuePosition = batch.status === 'pending'
        ? Number((await db
            .selectFrom('task_batches')
            .select((eb: any) => eb.fn.countAll().as('count'))
            .where('is_deleted', '=', false)
            .where('status', '=', 'pending')
            .where('provider', '=', batch.provider)
            .where('created_at', '<', batch.created_at)
            .executeTakeFirst() as any)?.count ?? 0)
        : null
      const processing = await db
        .selectFrom('tasks')
        .select('processing_started_at')
        .where('batch_id', '=', batch.id)
        .where('processing_started_at', 'is not', null)
        .orderBy('processing_started_at', 'asc')
        .executeTakeFirst()
      const { provider: _provider, ...item } = batch
      return { ...item, canvas_node_id: null, queue_position: queuePosition, processing_started_at: processing?.processing_started_at ?? null }
    }))

    const nextCursor = hasMore
      ? Buffer.from(JSON.stringify({ created_at: items[items.length - 1].created_at, id: items[items.length - 1].id })).toString('base64')
      : null

    return reply.send({ items, nextCursor })
  })

  // GET /video-studio/projects/:id/assets
  app.get<{
    Params: { id: string }
    Querystring: { limit?: string; cursor?: string; type?: string }
  }>('/video-studio/projects/:id/assets', async (request, reply) => {
    const db = getDb()
    const { id } = request.params
    const limitN = Math.min(parseInt(request.query.limit ?? '50', 10) || 50, 200)
    const cursor = request.query.cursor
    const type = request.query.type

    const access = await assertProjectAccess(id, request.user.id)
    if (!access) return reply.status(404).send({ error: 'not found' })

    let decodedCursor: { created_at: string; id: string } | null = null
    if (cursor) {
      try { decodedCursor = JSON.parse(Buffer.from(cursor, 'base64').toString('utf-8')) }
      catch { return reply.badRequest('Invalid cursor') }
    }

    let query = db
      .selectFrom('assets as a')
      .innerJoin('task_batches as b', 'b.id', 'a.batch_id')
      .select(['a.id', 'a.type', 'a.storage_url', 'a.original_url', 'a.created_at', 'b.id as batch_id', 'b.prompt', 'b.model'])
      .where('b.video_studio_project_id', '=', id)
      .where('a.is_deleted', '=', false)
      .where((eb: any) => eb.or([
        eb('a.transfer_status', '=', 'completed'),
        eb('a.original_url', 'is not', null),
      ]))
      .orderBy('a.created_at', 'desc')
      .orderBy('a.id', 'desc')
      .limit(limitN + 1) as any

    if (type) query = query.where('a.type', '=', type)

    if (decodedCursor) {
      query = query.where((eb: any) => eb.or([
        eb('a.created_at', '<', decodedCursor!.created_at),
        eb.and([eb('a.created_at', '=', decodedCursor!.created_at), eb('a.id', '<', decodedCursor!.id)]),
      ]))
    }

    const rows = await query.execute()
    const hasMore = rows.length > limitN
    const items = hasMore ? rows.slice(0, limitN) : rows
    const signedItems = await Promise.all(items.map(async (item: any) => ({
      ...item,
      canvas_node_id: null,
      storage_url: await signAssetUrl(item.storage_url),
      original_url: item.original_url ? await signAssetUrl(item.original_url) : null,
    })))

    const nextCursor = hasMore
      ? Buffer.from(JSON.stringify({ created_at: items[items.length - 1].created_at, id: items[items.length - 1].id })).toString('base64')
      : null

    return reply.send({ items: signedItems, nextCursor })
  })

  // PATCH /video-studio/projects/:id/name
  app.patch<{
    Params: { id: string }
    Body: { name: string }
  }>(
    '/video-studio/projects/:id/name',
    {
      schema: {
        body: {
          type: 'object',
          required: ['name'],
          properties: { name: { type: 'string', minLength: 1, maxLength: 200 } },
        },
      },
    },
    async (request, reply) => {
      const db = getDb()
      const name = request.body.name.trim()
      if (!name) return reply.status(400).send({ error: 'name required' })

      const access = await assertProjectAccess(request.params.id, request.user.id, true)
      if (!access) return reply.status(404).send({ error: 'not found' })

      await db
        .updateTable('video_studio_projects')
        .set({ name, updated_at: sql`now()` })
        .where('id', '=', request.params.id)
        .where('is_deleted', '=', false)
        .execute()

      return reply.send({ success: true, name })
    },
  )

  // DELETE /video-studio/projects/:id
  app.delete<{ Params: { id: string } }>(
    '/video-studio/projects/:id',
    async (request, reply) => {
      const db = getDb()
      const access = await assertProjectAccess(request.params.id, request.user.id, true)
      if (!access) return reply.status(404).send({ error: 'not found' })

      await db.transaction().execute(async (trx) => {
        await trx
          .updateTable('video_studio_projects')
          .set({ is_deleted: true, deleted_at: sql`now()`, updated_at: sql`now()` })
          .where('id', '=', request.params.id)
          .where('is_deleted', '=', false)
          .execute()
        await softDeleteProjectAssets(trx, 'video_studio_project_id', request.params.id)
      })

      return reply.send({ success: true })
    },
  )

  // GET /video-studio/projects/trash
  app.get<{ Querystring: { workspace_id: string } }>('/video-studio/projects/trash', async (request, reply) => {
    const db = getDb()
    const userId = request.user.id
    const { workspace_id } = request.query
    if (!workspace_id) return reply.status(400).send({ error: 'workspace_id required' })

    const member = await db
      .selectFrom('workspace_members')
      .select('role')
      .where('workspace_id', '=', workspace_id)
      .where('user_id', '=', userId)
      .executeTakeFirst()
    if (!member) return reply.status(403).send({ error: 'forbidden' })

    const projects = await db
      .selectFrom('video_studio_projects')
      .select(['id', 'name', 'created_at', 'updated_at', 'deleted_at', 'user_id', 'workspace_id'])
      .where('workspace_id', '=', workspace_id)
      .where('is_deleted', '=', true)
      .where((eb) => member.role === 'admin' ? eb.val(true) : eb('user_id', '=', userId))
      .orderBy('deleted_at', 'desc')
      .execute()

    return reply.send(projects)
  })

  // POST /video-studio/projects/:id/restore
  app.post<{ Params: { id: string } }>('/video-studio/projects/:id/restore', async (request, reply) => {
    const db = getDb()
    const access = await assertProjectAccess(request.params.id, request.user.id, true)
    if (!access) return reply.status(404).send({ error: 'not found' })

    await db.transaction().execute(async (trx) => {
      await trx
        .updateTable('video_studio_projects')
        .set({ is_deleted: false, deleted_at: null, updated_at: sql`now()` })
        .where('id', '=', request.params.id)
        .where('is_deleted', '=', true)
        .execute()
      await restoreProjectAssets(trx, 'video_studio_project_id', request.params.id)
    })

    return reply.send({ success: true })
  })

  // DELETE /video-studio/projects/:id/permanent
  app.delete<{ Params: { id: string } }>('/video-studio/projects/:id/permanent', async (request, reply) => {
    const db = getDb()
    const access = await assertProjectAccess(request.params.id, request.user.id, true)
    if (!access) return reply.status(404).send({ error: 'not found' })

    await purgeVideoStudioProject(db, request.params.id)
    return reply.send({ success: true })
  })
}
