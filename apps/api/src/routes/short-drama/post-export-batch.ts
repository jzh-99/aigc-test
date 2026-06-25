import type { FastifyInstance } from 'fastify'
import { randomUUID } from 'node:crypto'
import { getDb } from '@aigc/db'
import type { ShortDramaExportEpisodeJobData, ShortDramaEpisodeExport } from '@aigc/types'
import { deductBizMgmtPointsForGeneration } from '../../services/biz-mgmt-a-bean.js'
import { getShortDramaExportQueue } from '../../lib/queue.js'
import {
  assertShortDramaProjectAccess,
  invalidateShortDramaEpisodeExports,
  SHORT_DRAMA_EXPORT_COST_KEY,
} from './_shared.js'

const DEFAULT_EXPORT_CREDITS = 10

async function getExportCredits(): Promise<number> {
  const envVal = process.env[SHORT_DRAMA_EXPORT_COST_KEY]
  if (envVal) {
    const parsed = parseInt(envVal, 10)
    if (!isNaN(parsed) && parsed > 0) return parsed
  }
  return DEFAULT_EXPORT_CREDITS
}

interface ExportBatchBody {
  episodeNumbers: number[]
}

export default async function postExportBatch(app: FastifyInstance): Promise<void> {
  app.post<{ Params: { id: string }; Body: ExportBatchBody }>(
    '/short-drama/projects/:id/export-batch',
    {
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string', format: 'uuid' } },
        },
        body: {
          type: 'object',
          required: ['episodeNumbers'],
          properties: {
            episodeNumbers: {
              type: 'array',
              items: { type: 'integer', minimum: 1 },
              minItems: 1,
              maxItems: 50,
            },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const { id: projectId } = request.params
      const { episodeNumbers } = request.body
      const userId = request.user.id

      const { project, workspace } = await assertShortDramaProjectAccess(projectId, userId, true)
      const state = project.state
      const teamId = workspace.team_id

      if (!state.locks.assets) {
        return reply.status(400).send({
          success: false,
          error: { code: 'ASSETS_NOT_LOCKED', message: '素材未锁定，请先完成素材确认' },
        })
      }

      // 筛选可导出的集（有 segments 且所有 segment 都有 videoUrl）
      const exportableEpisodes = episodeNumbers
        .map(num => state.episodes.items.find(ep => ep.episodeNumber === num))
        .filter(ep => {
          if (!ep) return false
          if (ep.segments.length === 0) return false
          return ep.segments.every(s => !!s.videoUrl)
        })

      if (exportableEpisodes.length === 0) {
        return reply.status(400).send({
          success: false,
          error: { code: 'NO_EXPORTABLE_EPISODES', message: '没有可导出的集（需要所有分镜都已生成视频）' },
        })
      }

      const exportCreditsPerEpisode = await getExportCredits()
      const totalCost = exportCreditsPerEpisode * exportableEpisodes.length

      // 业管 A 豆扣减（批量级：实时余额校验 → 一次性扣总费用）
      let bizMgmtBilling: { requestNo: string; bizMgmtUserId: string; workNo: string }
      try {
        const deduction = await deductBizMgmtPointsForGeneration({
          localUserId: userId,
          teamId,
          workspaceId: project.workspace_id,
          batchId: `shortdrama-exportbatch-${project.id}`,
          pointsNum: totalCost,
          source: 1,
          remark: `短剧批量导出（${exportableEpisodes.length}集）`,
        })
        bizMgmtBilling = deduction
      } catch (err) {
        const msg = err instanceof Error ? err.message : '业管 A 豆扣减失败'
        return reply.status(402).send({
          success: false,
          error: { code: 'INSUFFICIENT_CREDITS', message: msg },
        })
      }

      const batchExportId = randomUUID()
      const exportEpisodeNumbers = exportableEpisodes.map(ep => ep!.episodeNumber)

      for (const episodeNumber of exportEpisodeNumbers) {
        invalidateShortDramaEpisodeExports(state, episodeNumber)
      }

      // 创建 batch export 记录
      const episodeExports: ShortDramaEpisodeExport[] = exportEpisodeNumbers.map(num => ({
        episodeNumber: num,
        status: 'pending' as const,
        videoUrl: null,
        errorMessage: null,
      }))

      state.exports.batches.push({
        id: batchExportId,
        episodeNumbers: exportEpisodeNumbers,
        exports: episodeExports,
        status: 'pending',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })

      const db = getDb()

      try {
        // 保存 state
        await db
          .updateTable('short_drama_projects')
          .set({
            state: JSON.stringify(state),
            updated_at: new Date(),
          })
          .where('id', '=', project.id)
          .execute()

        // 为每集入队导出任务（业管计费上下文共享，outbox dedupe_key 基于 requestNo 幂等）
        const jobs = exportEpisodeNumbers.map(num => ({
          name: 'export-episode',
          data: {
            projectId: project.id,
            episodeId: String(num),
            exportId: batchExportId,
            userId,
            teamId,
            workspaceId: project.workspace_id,
            estimatedCredits: exportCreditsPerEpisode,
            // 业管计费上下文，供 worker 终态写创作结果 outbox
            bizMgmtDeductRequestNo: bizMgmtBilling.requestNo,
            bizMgmtUserId: bizMgmtBilling.bizMgmtUserId,
            bizMgmtWorkNo: bizMgmtBilling.workNo,
          } satisfies ShortDramaExportEpisodeJobData,
        }))

        await getShortDramaExportQueue().addBulk(jobs)

        return reply.status(201).send({
          success: true,
          exportId: batchExportId,
          episodeCount: exportableEpisodes.length,
          totalCredits: totalCost,
          completedCount: 0,
          failedCount: 0,
        })
      } catch (err) {
        // 业管扣减已完成，本地不退；由 biz_mgmt_a_bean_transactions 审计 + 人工对账
        app.log.error({ err }, 'Failed to create batch export jobs')
        return reply.status(500).send({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: '批量导出任务创建失败，A 豆退款将由业管处理' },
        })
      }
    }
  )
}
