import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'
import { assertShortDramaWorkspaceAccess } from './_shared.js'

const route: FastifyPluginAsync = async (app) => {
  // GET /short-drama/projects - 列表查询
  app.get<{
    Querystring: {
      workspace_id: string
      cursor?: string
      limit?: number
    }
  }>('/short-drama/projects', async (request, reply) => {
    const { workspace_id, cursor, limit: rawLimit } = request.query

    // 校验 workspace 访问权限（只读）
    try {
      await assertShortDramaWorkspaceAccess(workspace_id, request.user.id, false)
    } catch (error) {
      const message = error instanceof Error ? error.message : '无权访问此工作空间'
      return reply.status(403).send({
        error: { code: 'FORBIDDEN', message }
      })
    }

    // 限制 limit 最大值为 100
    const limit = Math.min(rawLimit ?? 20, 100)

    const db = getDb()
    let query = db
      .selectFrom('short_drama_projects')
      .select([
        'id',
        'title',
        'prompt',
        'style',
        'aspect_ratio as aspectRatio',
        'episode_count as episodeCount',
        'status',
        'active_step as activeStep',
        'cover_url as coverUrl',
        'estimated_credits as estimatedCredits',
        'actual_credits as actualCredits',
        'draft_saved_at as draftSavedAt',
        'created_at as createdAt',
        'updated_at as updatedAt',
      ])
      .where('workspace_id', '=', workspace_id)
      .where('is_deleted', '=', false)
      .orderBy('updated_at', 'desc')
      .limit(limit + 1) // 多取一条用于判断是否有下一页

    // 如果有 cursor，则从 cursor 之后开始查询
    if (cursor) {
      try {
        const cursorDate = new Date(cursor)
        query = query.where('updated_at', '<', cursorDate)
      } catch {
        return reply.status(400).send({
          error: { code: 'INVALID_CURSOR', message: 'cursor 格式无效' }
        })
      }
    }

    const rows = await query.execute()

    // 判断是否有下一页
    const hasMore = rows.length > limit
    const items = hasMore ? rows.slice(0, limit) : rows

    // 生成下一页 cursor
    const nextCursor = hasMore && items.length > 0
      ? items[items.length - 1].updatedAt.toISOString()
      : null

    return {
      items,
      nextCursor,
      hasMore,
    }
  })

  // GET /short-drama/projects/recent - 最近项目
  app.get<{
    Querystring: {
      workspace_id: string
      limit?: number
    }
  }>('/short-drama/projects/recent', async (request, reply) => {
    const { workspace_id, limit: rawLimit } = request.query

    // 校验 workspace 访问权限（只读）
    try {
      await assertShortDramaWorkspaceAccess(workspace_id, request.user.id, false)
    } catch (error) {
      const message = error instanceof Error ? error.message : '无权访问此工作空间'
      return reply.status(403).send({
        error: { code: 'FORBIDDEN', message }
      })
    }

    // 限制 limit 最大值为 20
    const limit = Math.min(rawLimit ?? 10, 20)

    const items = await getDb()
      .selectFrom('short_drama_projects')
      .select([
        'id',
        'title',
        'prompt',
        'style',
        'aspect_ratio as aspectRatio',
        'episode_count as episodeCount',
        'status',
        'active_step as activeStep',
        'cover_url as coverUrl',
        'estimated_credits as estimatedCredits',
        'actual_credits as actualCredits',
        'draft_saved_at as draftSavedAt',
        'created_at as createdAt',
        'updated_at as updatedAt',
      ])
      .where('workspace_id', '=', workspace_id)
      .where('is_deleted', '=', false)
      .orderBy('updated_at', 'desc')
      .limit(limit)
      .execute()

    return { items }
  })
}

export default route
