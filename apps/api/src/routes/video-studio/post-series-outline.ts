import type { FastifyPluginAsync } from 'fastify'
import { callLLM, parseJSON } from './_shared.js'

// POST /video-studio/series-outline — AI 生成系列剧集大纲
const route: FastifyPluginAsync = async (app) => {
  const SERIES_OUTLINE_SYSTEM_PROMPT = process.env.AI_PROMPT_STUDIO_SERIES_OUTLINE ?? ''

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
        type SeriesCharacter = { name: string; description: string; voiceDescription?: string }
        type SeriesEpisode = { id: string; title: string; synopsis: string; coreConflict?: string; hook?: string }
        type SeriesScene = { name: string; description: string }
        type SeriesRelationship = { from: string; to: string; description: string }
        type SeriesResult = { title?: string; synopsis?: string; worldbuilding?: string; mainCharacters?: SeriesCharacter[]; mainScenes?: SeriesScene[]; relationships?: SeriesRelationship[]; episodes?: SeriesEpisode[] }
        const parsed = parseJSON<SeriesResult>(raw)
        return reply.send({
          success: true,
          title: parsed?.title ?? '',
          synopsis: parsed?.synopsis ?? '',
          worldbuilding: parsed?.worldbuilding ?? '',
          mainCharacters: parsed?.mainCharacters ?? [],
          mainScenes: parsed?.mainScenes ?? [],
          relationships: parsed?.relationships ?? [],
          episodes: parsed?.episodes ?? [],
        })
      } catch (err) {
        app.log.error(err, 'video-studio series-outline error')
        return reply.status(502).send({ success: false, error: { code: 'AI_ERROR', message: 'AI服务暂时不可用，请稍后重试' } })
      }
    },
  )
}

export default route
