import type { FastifyPluginAsync } from 'fastify'
import { sql } from 'kysely'
import { getDb } from '@aigc/db'
import type { ShortDramaState, ShortDramaStepId } from '@aigc/types'
import { normalizeShortDramaState } from '@aigc/types'
import {
  assertShortDramaProjectAccess,
  hasShortDramaGeneratingStatus,
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
      // 切换步骤：后端据此把 state.steps.active 设为该值（state.steps.active 是唯一真相）
      activeStep?: string
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
      // 生成中保护：库内任一文本流程在 generating 时，拒绝前端整份 state 覆盖。
      // 前端 SWR 缓存的 state 可能落后于数据库，直接覆盖会抹掉 generating 标记，
      // 造成「状态丢失 + Redis 锁仍在」的不一致。
      const currentState = await readShortDramaProjectState(id)
      if (hasShortDramaGeneratingStatus(currentState)) {
        return reply.status(409).send({
          error: { code: 'GENERATION_IN_PROGRESS', message: '生成进行中，请刷新页面查看最新结果' },
        })
      }
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

    // 处理 activeStep：切换步骤。state.steps.active 是步骤唯一真相（前端 stepper / 页面内容 /
    // 轮询全部依据它）。读库内当前 state（保留生成中等最新状态）→ 设 steps.active → 写回，
    // 避免前端回传过期整份 state 覆盖生成中状态。
    const activeStep = body.activeStep
    if (activeStep !== undefined) {
      const validSteps = ['script', 'assets', 'episodes']
      if (!validSteps.includes(activeStep)) {
        return reply.status(400).send({
          error: { code: 'VALIDATION_ERROR', message: '步骤值无效' }
        })
      }

      const baseState: ShortDramaState = updates.state
        ? (JSON.parse(updates.state as string) as ShortDramaState)
        : await readShortDramaProjectState(id)
      updates.state = JSON.stringify({
        ...baseState,
        steps: { ...baseState.steps, active: activeStep as ShortDramaStepId },
      })
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
