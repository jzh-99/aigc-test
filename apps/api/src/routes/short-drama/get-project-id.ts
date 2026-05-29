import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'
import type { ShortDramaState } from '@aigc/types'
import { normalizeShortDramaState } from '@aigc/types'
import { assertShortDramaProjectAccess } from './_shared.js'

const route: FastifyPluginAsync = async (app) => {
  // GET /short-drama/projects/:id - 获取项目详情
  app.get<{
    Params: { id: string }
  }>('/short-drama/projects/:id', async (request, reply) => {
    try {
      const { project } = await assertShortDramaProjectAccess(
        request.params.id,
        request.user.id,
        false
      )

      // 获取完整项目信息
      const fullProject = await getDb()
        .selectFrom('short_drama_projects')
        .selectAll()
        .where('id', '=', request.params.id)
        .executeTakeFirst()

      if (!fullProject) {
        return reply.status(404).send({
          error: { code: 'PROJECT_NOT_FOUND', message: '短剧项目不存在' }
        })
      }
      // 解析并 normalize state
      let state = fullProject.state
      if (typeof fullProject.state === 'string') {
        state = JSON.parse(fullProject.state)
      }
      state = normalizeShortDramaState(state as ShortDramaState)

      return {
        id: fullProject.id,
        workspaceId: fullProject.workspace_id,
        teamId: fullProject.team_id,
        userId: fullProject.user_id,
        title: fullProject.title,
        prompt: fullProject.prompt,
        style: fullProject.style,
        aspectRatio: fullProject.aspect_ratio,
        episodeCount: fullProject.episode_count,
        status: fullProject.status,
        activeStep: fullProject.active_step,
        coverUrl: fullProject.cover_url,
        state,
        estimatedCredits: fullProject.estimated_credits,
        actualCredits: fullProject.actual_credits,
        draftSavedAt: fullProject.draft_saved_at,
        createdAt: fullProject.created_at,
        updatedAt: fullProject.updated_at,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '项目不存在'
      return reply.status(404).send({
        error: { code: 'PROJECT_NOT_FOUND', message }
      })
    }
  })

  // GET /short-drama/projects/:id/export-status - 获取导出状态
  app.get<{
    Params: { id: string }
  }>('/short-drama/projects/:id/export-status', async (request, reply) => {
    try {
      const { project } = await assertShortDramaProjectAccess(
        request.params.id,
        request.user.id,
        false
      )

      return {
        exports: project.state.exports || []
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '项目不存在'
      return reply.status(404).send({
        error: { code: 'PROJECT_NOT_FOUND', message }
      })
    }
  })
}

export default route
