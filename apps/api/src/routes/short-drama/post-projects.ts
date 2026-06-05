import type { FastifyPluginAsync } from 'fastify'
import { sql } from 'kysely'
import { getDb } from '@aigc/db'
import {
  makeDefaultShortDramaState,
  makeUploadedShortDramaState,
} from '@aigc/types'
import { assertShortDramaWorkspaceAccess, validateShortDramaEpisodeCount } from './_shared.js'
import { normalizeShortDramaOriginalScript } from './_script-source.js'

// 标题截断长度常量
const TITLE_MAX_LENGTH = 24

const route: FastifyPluginAsync = async (app) => {
  app.post<{
    Body: {
      workspace_id: string
      prompt: string
      source?: 'idea' | 'upload'
      original_script?: string
      style: string
      aspect_ratio: '9:16' | '16:9'
      episode_count: number
      // 第一版由共享默认模型管理，当前不信任/不使用前端传入模型
      text_model?: string
    }
  }>('/short-drama/projects', async (request, reply) => {
    const body = request.body

    // 校验 workspace 访问权限（需要写权限）
    try {
      await assertShortDramaWorkspaceAccess(body.workspace_id, request.user.id, true)
    } catch (error) {
      const message = error instanceof Error ? error.message : '无权创建短剧项目'
      return reply.status(403).send({
        error: { code: 'FORBIDDEN', message }
      })
    }

    const source = body.source ?? 'idea'

    if (source !== 'idea' && source !== 'upload') {
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: '剧本来源仅支持创意生成或上传剧本' }
      })
    }

    // 校验创意或原始剧本
    const prompt = body.prompt?.trim() ?? ''
    let originalScript = ''
    if (source === 'idea' && !prompt) {
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: '请输入短剧创意' }
      })
    }
    if (source === 'upload') {
      try {
        originalScript = normalizeShortDramaOriginalScript(body.original_script ?? '')
      } catch (error) {
        const message = error instanceof Error ? error.message : '原始剧本无效'
        return reply.status(400).send({
          error: { code: 'VALIDATION_ERROR', message }
        })
      }
    }

    // 校验 aspect_ratio
    if (body.aspect_ratio !== '9:16' && body.aspect_ratio !== '16:9') {
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: '比例仅支持 9:16 或 16:9' }
      })
    }

    // 校验集数。上传剧本模式先使用占位集数，实际集数由摘要提炼时的大模型返回。
    let episodeCount: number
    if (source === 'upload') {
      episodeCount = 1
    } else {
      try {
        episodeCount = validateShortDramaEpisodeCount(body.episode_count, 'idea')
      } catch (error) {
        const message = error instanceof Error ? error.message : '集数参数无效'
        return reply.status(400).send({
          error: { code: 'VALIDATION_ERROR', message }
        })
      }
    }

    // 生成默认 state
    const state = source === 'upload'
      ? makeUploadedShortDramaState({
          originalScript,
          style: body.style,
          aspectRatio: body.aspect_ratio,
          episodeCount,
        })
      : makeDefaultShortDramaState({
          prompt,
          style: body.style,
          aspectRatio: body.aspect_ratio,
          episodeCount,
        })

    // 生成标题（取 prompt 前 24 字符）
    const titleSource = source === 'upload' ? originalScript : prompt
    const title = titleSource.slice(0, TITLE_MAX_LENGTH) || '未命名短剧'

    // 获取 workspace 的 team_id
    const workspace = await getDb()
      .selectFrom('workspaces')
      .select('team_id')
      .where('id', '=', body.workspace_id)
      .executeTakeFirst()

    if (!workspace) {
      return reply.status(404).send({
        error: { code: 'WORKSPACE_NOT_FOUND', message: '工作空间不存在' }
      })
    }

    // 插入项目
    const project = await getDb()
      .insertInto('short_drama_projects')
      .values({
        workspace_id: body.workspace_id,
        team_id: workspace.team_id,
        user_id: request.user.id,
        title,
        prompt: source === 'upload' ? '' : prompt,
        style: state.settings.style,
        aspect_ratio: state.settings.aspectRatio,
        episode_count: state.settings.episodeCount,
        status: 'draft',
        active_step: 'script',
        state: JSON.stringify(state),
        estimated_credits: 0,
        actual_credits: 0,
        draft_saved_at: sql`now()`,
      })
      .returning(['id'])
      .executeTakeFirstOrThrow()

    return { projectId: project.id, state }
  })
}

export default route
