import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'
import { sql } from 'kysely'

// POST /canvases/:id/node-outputs/:nodeId — 写入预生成输出（如视频工作室导出）
const route: FastifyPluginAsync = async (app) => {
  app.post<{ Params: { id: string; nodeId: string }; Body: { output_urls: string[]; is_selected?: boolean } }>(
    '/canvases/:id/node-outputs/:nodeId',
    async (request, reply) => {
      const db = getDb()
      const { id, nodeId } = request.params
      const { output_urls, is_selected = true } = request.body

      const canvas = await db
        .selectFrom('canvases')
        .select('workspace_id')
        .where('id', '=', id)
        .executeTakeFirst()
      if (!canvas) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: '画布不存在' } })

      const member = await db
        .selectFrom('workspace_members')
        .select('role')
        .where('workspace_id', '=', canvas.workspace_id)
        .where('user_id', '=', request.user.id)
        .executeTakeFirst()
      if (!member) return reply.status(403).send({ success: false, error: { code: 'FORBIDDEN', message: '无权访问该画布' } })

      // 使用 sql.raw 构建 PostgreSQL 数组字面量
      const urlsLiteral = output_urls.map((u) => `'${u.replace(/'/g, "''")}'`).join(',')
      const row = await db
        .insertInto('canvas_node_outputs')
        .values({
          canvas_id: id,
          node_id: nodeId,
          output_urls: sql.raw(`ARRAY[${urlsLiteral}]::text[]`),
          is_selected,
        })
        .returning('id')
        .executeTakeFirstOrThrow()

      return reply.status(201).send({ id: row.id })
    }
  )
}

export default route
