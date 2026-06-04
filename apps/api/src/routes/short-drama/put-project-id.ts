import type { FastifyPluginAsync } from 'fastify'
import { sql } from 'kysely'
import { getDb } from '@aigc/db'
import type { ShortDramaState } from '@aigc/types'
import { normalizeShortDramaState } from '@aigc/types'
import {
  assertShortDramaProjectAccess,
  readShortDramaProjectState,
  syncShortDramaSegmentsFromState,
} from './_shared.js'

const route: FastifyPluginAsync = async (app) => {
  app.put<{
    Params: { id: string }
    Body: {
      state?: ShortDramaState
      title?: string
      cover_url?: string
      status?: string
      active_step?: string
    }
  }>('/short-drama/projects/:id', async (request, reply) => {
    const { id } = request.params
    const body = request.body

    // 校验项目访问权限（需要写权限）
    let currentProject
    try {
      const access = await assertShortDramaProjectAccess(id, request.user.id, true)
      currentProject = access.project
    } catch (error) {
      const message = error instanceof Error ? error.message : '项目不存在'
      return reply.status(404).send({
        error: { code: 'PROJECT_NOT_FOUND', message }
      })
    }

    // 准备更新数据
    const updates: Record<string, unknown> = {
      updated_at: sql`now()`,
    }

    // 处理 state
    if (body.state !== undefined) {
      try {
        const normalizedState = normalizeShortDramaState(body.state)
        await syncShortDramaSegmentsFromState(id, normalizedState)
        updates.state = JSON.stringify(normalizedState)
      } catch (error) {
        return reply.status(400).send({
          error: { code: 'VALIDATION_ERROR', message: '状态数据格式无效' }
        })
      }
    }

    // 处理 title
    if (body.title !== undefined) {
      const title = body.title.trim()
      if (!title) {
        return reply.status(400).send({
          error: { code: 'VALIDATION_ERROR', message: '标题不能为空' }
        })
      }
      updates.title = title
    }

    // 处理 cover_url
    if (body.cover_url !== undefined) {
      updates.cover_url = body.cover_url || null
    }

    // 处理 status
    if (body.status !== undefined) {
      const validStatuses = [
        'draft',
        'summary_ready',
        'outline_ready',
        'assets_ready',
        'episodes_ready',
        'completed',
        'failed'
      ]
      if (!validStatuses.includes(body.status)) {
        return reply.status(400).send({
          error: { code: 'VALIDATION_ERROR', message: '状态值无效' }
        })
      }
      updates.status = body.status
    }

    // 处理 active_step
    if (body.active_step !== undefined) {
      const validSteps = ['script', 'assets', 'episodes']
      if (!validSteps.includes(body.active_step)) {
        return reply.status(400).send({
          error: { code: 'VALIDATION_ERROR', message: '步骤值无效' }
        })
      }
      updates.active_step = body.active_step
    }

    // 更新 draft_saved_at
    updates.draft_saved_at = sql`now()`

    // 执行更新
    await getDb()
      .updateTable('short_drama_projects')
      .set(updates)
      .where('id', '=', id)
      .execute()

    // 返回更新后的项目详情
    const updatedProject = await getDb()
      .selectFrom('short_drama_projects')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst()

    if (!updatedProject) {
      return reply.status(404).send({
        error: { code: 'PROJECT_NOT_FOUND', message: '项目不存在' }
      })
    }

    const state = await readShortDramaProjectState(updatedProject.id)

    return {
      id: updatedProject.id,
      workspaceId: updatedProject.workspace_id,
      teamId: updatedProject.team_id,
      userId: updatedProject.user_id,
      title: updatedProject.title,
      prompt: updatedProject.prompt,
      style: updatedProject.style,
      aspectRatio: updatedProject.aspect_ratio,
      episodeCount: updatedProject.episode_count,
      status: updatedProject.status,
      activeStep: updatedProject.active_step,
      coverUrl: updatedProject.cover_url,
      state,
      estimatedCredits: updatedProject.estimated_credits,
      actualCredits: updatedProject.actual_credits,
      draftSavedAt: updatedProject.draft_saved_at,
      createdAt: updatedProject.created_at,
      updatedAt: updatedProject.updated_at,
    }
  })
}

export default route
