import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'
import { signAssetUrls } from '../../lib/storage.js'
import { CANVAS_ENABLED_TEAM_TYPES } from './_shared.js'

// GET /canvases — 列出用户的画布，可按 workspace_id 过滤
const route: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: { workspace_id?: string } }>('/canvases', async (request, reply) => {
    const db = getDb()
    const userId = request.user.id
    const filterWsId = (request.query as any).workspace_id as string | undefined

    // 获取用户所属且已开通画布功能的所有工作区 ID
    const memberships = await db
      .selectFrom('workspace_members')
      .innerJoin('workspaces', 'workspaces.id', 'workspace_members.workspace_id')
      .innerJoin('teams', 'teams.id', 'workspaces.team_id')
      .select('workspace_members.workspace_id')
      .where('workspace_members.user_id', '=', userId)
      .where('teams.team_type', 'in', CANVAS_ENABLED_TEAM_TYPES)
      .execute()

    const wsIds = memberships.map((m: any) => m.workspace_id)
    if (wsIds.length === 0) return reply.send([])

    // 若提供了 workspace_id 过滤，验证成员关系后缩小范围
    const targetWsIds = filterWsId
      ? wsIds.filter((id) => id === filterWsId)
      : wsIds
    if (targetWsIds.length === 0) return reply.send([])

    const canvases = await db
      .selectFrom('canvases')
      .select(['id', 'name', 'created_at', 'updated_at'])
      .where('workspace_id', 'in', targetWsIds)
      .where('is_deleted', '=', false)
      .orderBy('updated_at', 'desc')
      .execute()

    const previewMap: Record<string, string[]> = {}

    if (canvases.length > 0) {
      const canvasIds = canvases.map((c) => c.id)
      const rows = await db
        .selectFrom('canvas_node_outputs')
        .select(['canvas_id', 'output_urls'])
        .where('canvas_id', 'in', canvasIds)
        .orderBy('created_at', 'desc')
        .execute()

      for (const row of rows) {
        const cid = row.canvas_id as string
        if (!previewMap[cid]) previewMap[cid] = []
        if (previewMap[cid].length >= 2) continue

        const url = (row.output_urls as string[] | null)?.[0]
        if (!url) continue
        // 跳过视频文件
        if (/\.(mp4|mov|webm)(\?|$)/i.test(url)) continue

        previewMap[cid].push(url)
      }

      // 对没有输出预览的画布，从 structure_data 中提取资产节点图片
      const canvasIdsNeedAssetPreview = canvasIds.filter((id) => !previewMap[id]?.length)
      if (canvasIdsNeedAssetPreview.length > 0) {
        const structureRows = await db
          .selectFrom('canvases')
          .select(['id', 'structure_data'])
          .where('id', 'in', canvasIdsNeedAssetPreview)
          .execute()

        for (const row of structureRows) {
          const structureData = row.structure_data as { nodes?: Array<{ type?: string; data?: { config?: { url?: string; mimeType?: string } } }> } | null
          const urls: string[] = []
          for (const node of structureData?.nodes ?? []) {
            if (node.type !== 'asset') continue
            const url = node.data?.config?.url
            if (!url) continue
            const mimeType = node.data?.config?.mimeType ?? ''
            if (mimeType.startsWith('video/') || mimeType.startsWith('audio/')) continue
            if (/\.(mp4|mov|webm)(\?|$)/i.test(url)) continue
            urls.push(url)
            if (urls.length >= 2) break
          }
          if (urls.length > 0) previewMap[row.id] = urls
        }
      }
    }

    // 对所有预览 URL 签名
    await Promise.all(
      Object.keys(previewMap).map((cid) =>
        signAssetUrls(previewMap[cid]).then((signed) => { previewMap[cid] = signed })
      ),
    )

    return reply.send(canvases.map((c) => ({ ...c, preview_urls: previewMap[c.id] ?? [] })))
  })
}

export default route
