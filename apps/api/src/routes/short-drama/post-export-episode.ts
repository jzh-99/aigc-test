import type { FastifyInstance } from 'fastify'
import { randomUUID } from 'node:crypto'
import { getDb } from '@aigc/db'
import type { ShortDramaExportEpisodeJobData } from '@aigc/types'
import { freezeCredits, refundCredits } from '../../services/credit.js'
import { getShortDramaExportQueue } from '../../lib/queue.js'
import { assertShortDramaProjectAccess, SHORT_DRAMA_EXPORT_COST_KEY } from './_shared.js'

const DEFAULT_EXPORT_CREDITS = 10

async function getExportCredits(): Promise<number> {
  const envVal = process.env[SHORT_DRAMA_EXPORT_COST_KEY]
  if (envVal) {
    const parsed = parseInt(envVal, 10)
    if (!isNaN(parsed) && parsed > 0) return parsed
  }
  return DEFAULT_EXPORT_CREDITS
}

export default async function postExportEpisode(app: FastifyInstance): Promise<void> {
  app.post<{ Params: { id: string; episodeNumber: string } }>(
    '/short-drama/projects/:id/episodes/:episodeNumber/export',
    {
      schema: {
        params: {
          type: 'object',
          required: ['id', 'episodeNumber'],
          properties: {
            id: { type: 'string', format: 'uuid' },
            episodeNumber: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      const { id: projectId, episodeNumber: epNumStr } = request.params
      const userId = request.user.id
      const episodeNumber = parseInt(epNumStr, 10)

      if (isNaN(episodeNumber) || episodeNumber < 1) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_PARAMS', message: '集数必须是正整数' },
        })
      }

      const { project, workspace } = await assertShortDramaProjectAccess(projectId, userId, true)
      const state = project.state
      const teamId = workspace.team_id

      // 检查 assets 锁定
      if (!state.locks.assets) {
        return reply.status(400).send({
          success: false,
          error: { code: 'ASSETS_NOT_LOCKED', message: '素材未锁定，请先完成素材确认' },
        })
      }

      const episode = state.episodes.items.find(ep => ep.episodeNumber === episodeNumber)
      if (!episode) {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: `第 ${episodeNumber} 集不存在` },
        })
      }

      if (episode.segments.length === 0) {
        return reply.status(400).send({
          success: false,
          error: { code: 'NO_SEGMENTS', message: '该集没有分镜，无法导出' },
        })
      }

      // 检查所有 segment 是否都有 videoUrl
      const missingVideo = episode.segments.filter(s => !s.videoUrl)
      if (missingVideo.length > 0) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'SEGMENTS_NOT_READY',
            message: `有 ${missingVideo.length} 个分镜尚未生成视频`,
          },
        })
      }

      const exportCredits = await getExportCredits()

      // 冻结积分
      let creditAccountId: string
      try {
        const result = await freezeCredits(teamId, userId, exportCredits)
        creditAccountId = result.creditAccountId
      } catch (err) {
        const msg = err instanceof Error ? err.message : '积分不足'
        return reply.status(402).send({
          success: false,
          error: { code: 'INSUFFICIENT_CREDITS', message: msg },
        })
      }

      const exportId = randomUUID()

      // 在 state.exports.batches 中创建导出记录
      state.exports.batches.push({
        id: exportId,
        episodeNumbers: [episodeNumber],
        exports: [{
          episodeNumber,
          status: 'pending',
          videoUrl: null,
          errorMessage: null,
        }],
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

        // 入队导出任务
        const jobData: ShortDramaExportEpisodeJobData = {
          projectId: project.id,
          episodeId: String(episodeNumber),
          exportId,
          userId,
          teamId,
          workspaceId: project.workspace_id,
          creditAccountId,
          estimatedCredits: exportCredits,
        }

        await getShortDramaExportQueue().add('export-episode', jobData)

        return reply.status(201).send({
          success: true,
          exportId,
          episodeNumber,
          estimatedCredits: exportCredits,
        })
      } catch (err) {
        app.log.error({ err }, 'Failed to create export job, refunding')
        try {
          await refundCredits(teamId, creditAccountId, userId, exportCredits)
        } catch (refundErr) {
          app.log.error({ refundErr }, 'CRITICAL: Failed to refund after export failure')
        }
        return reply.status(500).send({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: '导出任务创建失败，积分已退回' },
        })
      }
    }
  )
}
