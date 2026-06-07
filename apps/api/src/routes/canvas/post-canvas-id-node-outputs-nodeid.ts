import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'
import { sql } from 'kysely'
import { normalizeStorageUrl } from '../../lib/storage.js'

// POST /canvases/:id/node-outputs/:nodeId — 写入预生成输出（如视频工作室导出）
// 若节点已存在 is_selected=true 的记录则替换，否则新增
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

      // 构建 PostgreSQL text[] 字面量：ARRAY['url1','url2']
      const normalizedOutputUrls = output_urls.map((url) => normalizeStorageUrl(url) ?? url)
      const urlsArray = sql<string>`ARRAY[${sql.join(normalizedOutputUrls.map((u) => sql`${u}`), sql`, `)}]`

      // 查找该节点已有的 is_selected 记录，有则替换，无则新增
      const existing = await db
        .selectFrom('canvas_node_outputs')
        .select('id')
        .where('canvas_id', '=', id)
        .where('node_id', '=', nodeId)
        .where('is_selected', '=', true)
        .orderBy('created_at', 'desc')
        .limit(1)
        .executeTakeFirst()

      if (existing) {
        await db
          .updateTable('canvas_node_outputs')
          .set({ output_urls: urlsArray, is_selected })
          .where('id', '=', existing.id)
          .execute()
        return reply.status(200).send({ id: existing.id })
      }

      const row = await db
        .insertInto('canvas_node_outputs')
        .values({
          canvas_id: id,
          node_id: nodeId,
          output_urls: urlsArray,
          is_selected,
        })
        .returning('id')
        .executeTakeFirstOrThrow()

      return reply.status(201).send({ id: row.id })
    }
  )
}

export default route
