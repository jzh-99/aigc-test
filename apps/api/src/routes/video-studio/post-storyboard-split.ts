import type { FastifyPluginAsync } from 'fastify'
import { callLLM, parseJSON } from './_shared.js'

// POST /video-studio/storyboard-split — AI 将剧本拆分为分镜/片段
const route: FastifyPluginAsync = async (app) => {
  const STORYBOARD_SYSTEM_PROMPT = process.env.AI_PROMPT_STUDIO_STORYBOARD ?? ''

  app.post<{
    Body: {
      script: string
      shotCount?: number
      fragmentCount?: number
      duration?: number
      aspectRatio?: string
      style?: string
      characters?: Array<{ name: string; description: string; voiceDescription?: string; visualPresence?: boolean }>
      scenes?: Array<{ name: string; description: string }>
    }
  }>(
    '/video-studio/storyboard-split',
    {
      schema: {
        body: {
          type: 'object',
          required: ['script'],
          properties: {
            script: { type: 'string', maxLength: 10000 },
            shotCount: { type: 'number', minimum: 0, maximum: 50 },
            fragmentCount: { type: 'number', minimum: 0, maximum: 50 },
            duration: { type: 'number', minimum: 10, maximum: 600 },
            aspectRatio: { type: 'string' },
            style: { type: 'string', maxLength: 200 },
            characters: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, description: { type: 'string' }, voiceDescription: { type: 'string' } } } },
            scenes: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, description: { type: 'string' } } } },
          },
        },
      },
    },
    async (request, reply) => {
      const { script, shotCount = 0, fragmentCount, duration, aspectRatio, style, characters, scenes } = request.body
      const targetFragmentCount = fragmentCount ?? (duration ? Math.ceil(duration / 12) : shotCount > 0 ? Math.ceil(shotCount / 2) : 0)
      const countInstruction = targetFragmentCount > 0 ? `拆分成恰好 ${targetFragmentCount} 个长片段，每个片段 10-15 秒且包含 1-3 个分镜` : '根据剧本内容自动决定片段数量（每个片段10-15秒，每个片段1-3个分镜）'
      const ratioNote = aspectRatio ? `\n画面比例：${aspectRatio}` : ''
      const styleNote = style ? `\n整体视觉风格：${style}` : ''
      const charList = characters?.length ? `\n\n可用角色列表（characters 字段只能从这里选取名字；有台词时使用【角色名音色】占位符引用对应 voiceDescription）：\n${characters.map(c => `- ${c.name}：${c.description}${c.voiceDescription ? `；音色：${c.voiceDescription}` : ''}`).join('\n')}` : ''
      const sceneList = scenes?.length ? `\n\n可用场景列表（scene 字段只能从这里选取名字）：\n${scenes.map(s => `- ${s.name}：${s.description}`).join('\n')}` : ''
      const userPrompt = `请将以下剧本${countInstruction}${ratioNote}${styleNote}${charList}${sceneList}。\n\n每个片段必须填写 transition 和 duration；每个分镜必须填写 characters、scene、duration、content 和 visualPrompt。content 必须与 visualPrompt 保持一致或高度一致。详细景别、角度、构图、焦点变化和运镜过程必须写进 visualPrompt。台词直接写在 visualPrompt 里；有台词时，台词后写"【角色名音色】语气：..."。\n\n剧本：\n\n${script}`

      try {
        const raw = await callLLM(STORYBOARD_SYSTEM_PROMPT, userPrompt, 8000)
        type ShotRaw = { id: string; label: string; content: string; characters?: string[]; scene?: string; duration: number; visualPrompt?: string }
        type FragmentRaw = { id: string; label: string; duration: number; transition?: string; shots: ShotRaw[] }
        type StoryboardResult = { fragments?: FragmentRaw[]; shots?: ShotRaw[] }
        const parsed = parseJSON<StoryboardResult>(raw)
        const fragments = parsed?.fragments ?? (parsed?.shots ? [{ id: 'fragment_1', label: '片段1', duration: parsed.shots.reduce((sum, shot) => sum + (shot.duration || 0), 0), shots: parsed.shots }] : [])
        return reply.send({ success: true, fragments, shots: fragments.flatMap((fragment) => fragment.shots ?? []) })
      } catch (err) {
        app.log.error(err, 'video-studio storyboard-split error')
        return reply.status(502).send({ success: false, error: { code: 'AI_ERROR', message: 'AI服务暂时不可用，请稍后重试' } })
      }
    },
  )
}

export default route
