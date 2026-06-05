import type { FastifyPluginAsync } from 'fastify'
import { sql } from 'kysely'
import { getDb } from '@aigc/db'
import { assertShortDramaProjectAccess } from './_shared.js'
import { normalizeShortDramaOriginalScript } from './_script-source.js'

const route: FastifyPluginAsync = async (app) => {
  app.put<{
    Params: { id: string }
    Body: {
      originalPrompt?: string
      originalScript?: string
    }
  }>('/short-drama/projects/:id/script/source', async (request, reply) => {
    const { id: projectId } = request.params
    const body = request.body ?? {}

    let projectData
    try {
      projectData = await assertShortDramaProjectAccess(projectId, request.user.id, true)
    } catch (error) {
      const message = error instanceof Error ? error.message : '无权访问该项目'
      return reply.status(403).send({
        error: { code: 'FORBIDDEN', message },
      })
    }

    const { project } = projectData
    const state = project.state

    // 仅在摘要尚未生成、且未在生成中时允许编辑剧本来源
    if (state.script.refinedPrompt) {
      return reply.status(409).send({
        error: { code: 'ALREADY_GENERATED', message: '剧本摘要已生成，无法再修改原始内容' },
      })
    }
    if (state.script.status === 'generating') {
      return reply.status(409).send({
        error: { code: 'GENERATION_IN_PROGRESS', message: '剧本摘要正在生成中，请稍后再试' },
      })
    }

    const projectUpdate: Record<string, unknown> = {
      updated_at: sql`now()`,
      draft_saved_at: sql`now()`,
    }

    try {
      if (state.script.source === 'upload') {
        if (typeof body.originalScript !== 'string') {
          return reply.status(400).send({
            error: { code: 'VALIDATION_ERROR', message: '原始剧本不能为空' },
          })
        }
        const normalized = normalizeShortDramaOriginalScript(body.originalScript)
        state.script.originalScript = normalized
      } else {
        if (typeof body.originalPrompt !== 'string') {
          return reply.status(400).send({
            error: { code: 'VALIDATION_ERROR', message: '原始创意不能为空' },
          })
        }
        const trimmed = body.originalPrompt.trim()
        if (!trimmed) {
          return reply.status(400).send({
            error: { code: 'VALIDATION_ERROR', message: '原始创意不能为空' },
          })
        }
        if (trimmed.length > 2000) {
          return reply.status(400).send({
            error: { code: 'VALIDATION_ERROR', message: '原始创意不能超过 2000 字' },
          })
        }
        state.script.originalPrompt = trimmed
        projectUpdate.prompt = trimmed
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '原始剧本格式错误'
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message },
      })
    }

    projectUpdate.state = JSON.stringify(state)

    await getDb()
      .updateTable('short_drama_projects')
      .set(projectUpdate)
      .where('id', '=', projectId)
      .execute()

    return {
      success: true,
      state,
    }
  })
}

export default route
