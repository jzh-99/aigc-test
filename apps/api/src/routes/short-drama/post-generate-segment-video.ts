import type { FastifyInstance } from 'fastify'
import { randomUUID } from 'node:crypto'
import { getDb } from '@aigc/db'
import {
  SHORT_DRAMA_VIDEO_MODEL,
  findShortDramaMentionedAssets,
  getShortDramaAssetMentionAliases,
  parseCategoryReferences,
} from '@aigc/types'
import type { ShortDramaAsset, ShortDramaAspectRatio, ShortDramaSegment } from '@aigc/types'
import { freezeCredits } from '../../services/credit.js'
import { resolveUnitPrice } from '../../lib/pricing.js'
import { encryptProxyUrl } from '../../lib/storage.js'
import { getVideoQueue } from '../../lib/queue.js'
import {
  assertShortDramaProjectAccess,
  invalidateShortDramaEpisodeExports,
  makeShortDramaSourceMetadata,
  validateShortDramaDuration,
} from './_shared.js'

interface GenerateSegmentVideoBody {
  model?: string
  resolution?: string
}

type ShortDramaSegmentVideoState = ShortDramaSegment & {
  videoBatchId?: string | null
  videoTaskId?: string | null
}

const SEEDANCE_ALLOWED_DURATIONS = [4, 5, 6, 7, 8, 9, 10, 11, 12]
const SEEDANCE_2_ALLOWED_DURATIONS = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]
const NEGATIVE_VIDEO_PROMPT = '画面模糊、人物畸形、光影杂乱、卡通画风、画质糊边、多余杂物、画面卡顿、镜头跳切突兀、人物身份混乱、参考形象不一致、手持道具朝向跳变、关键道具接触点无因果变化'

interface PromptReferenceAsset {
  asset: ShortDramaAsset
  imageUrl: string
  figureIndex: number
}

interface ParsedShot {
  shotNumber: number
  durationSeconds: number
  text: string
}

function parseSegmentShots(prompt: string): ParsedShot[] {
  const pattern = /分镜\s*(\d+)\s*[·.\-:：]\s*(\d+)\s*s\s*[：:]\s*/gi
  const matches = [...prompt.matchAll(pattern)]
  return matches.map((match, index) => {
    const start = (match.index ?? 0) + match[0].length
    const end = index + 1 < matches.length ? matches[index + 1].index ?? prompt.length : prompt.length
    return {
      shotNumber: Number(match[1]),
      durationSeconds: Number(match[2]),
      text: prompt.slice(start, end).trim(),
    }
  }).filter(shot => (
    Number.isInteger(shot.shotNumber) &&
    Number.isInteger(shot.durationSeconds) &&
    shot.durationSeconds > 0 &&
    shot.text.length > 0
  ))
}

function extractSceneSetting(prompt: string): string {
  const marker = '本片段场景设定在：'
  const markerIndex = prompt.indexOf(marker)
  if (markerIndex < 0) return ''

  const rest = prompt.slice(markerIndex + marker.length)
  const shotIndex = rest.search(/分镜\s*\d+/)
  return (shotIndex >= 0 ? rest.slice(0, shotIndex) : rest).trim()
}

function buildPromptReferences(
  segment: ShortDramaSegment,
  assets: ShortDramaAsset[],
  toPublicUrl: (url: string) => string,
): PromptReferenceAsset[] {
  const referencedAssetIds = new Set<string>()
  for (const ref of segment.mentionRefs) {
    referencedAssetIds.add(ref.assetId)
  }

  for (const asset of assets) {
    if (!asset.imageUrl || referencedAssetIds.has(asset.id)) continue

    if (findShortDramaMentionedAssets(segment.prompt, [asset]).length > 0) {
      referencedAssetIds.add(asset.id)
    }
  }

  const mentionedAssets = assets.filter(asset => referencedAssetIds.has(asset.id) && asset.imageUrl)
  const sceneAssets = mentionedAssets.filter(asset => asset.kind === 'scene')
  const otherAssets = mentionedAssets.filter(asset => asset.kind !== 'scene')
  return [...sceneAssets, ...otherAssets].map((asset, index) => ({
    asset,
    imageUrl: toPublicUrl(asset.imageUrl!),
    figureIndex: index + 1,
  }))
}

function attachReferenceLabels(text: string, references: PromptReferenceAsset[]): string {
  let output = text
  const sortedReferences = [...references].sort((a, b) => {
    const maxAliasLength = (asset: ShortDramaAsset) => Math.max(
      ...getShortDramaAssetMentionAliases(asset).map(alias => alias.length),
    )
    return maxAliasLength(b.asset) - maxAliasLength(a.asset)
  })
  for (const reference of sortedReferences) {
    const aliases = getShortDramaAssetMentionAliases(reference.asset)
    const escapedNames = aliases.map(alias => alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    const pattern = new RegExp(`@(${escapedNames.join('|')})(?!（参考<图\\d+>）)`, 'gu')
    output = output.replace(pattern, `@${reference.asset.name}（参考<图${reference.figureIndex}>）`)
  }
  return output
}

export function buildShortDramaFinalVideoPrompt(input: {
  segment: ShortDramaSegment
  assets: ShortDramaAsset[]
  toPublicUrl?: (url: string) => string
  references: PromptReferenceAsset[]
  aspectRatio: ShortDramaAspectRatio
}): string {
  const { segment, aspectRatio } = input
  const references = input.references.length > 0
    ? input.references
    : buildPromptReferences(segment, input.assets, input.toPublicUrl ?? ((url) => url))
  const shots = parseSegmentShots(segment.prompt)
  const sceneSetting = extractSceneSetting(segment.prompt)
  const shotCountText = shots.length > 0 ? `${shots.length} 段镜头依次连贯播放` : '多段镜头依次连贯播放'
  const settingText = sceneSetting || segment.title
  const totalDuration = segment.durationSeconds

  const basePrompt = [
    `写实现代都市短片，${attachReferenceLabels(settingText, references)}`,
    '真人影视剧画质，4K 高清，电影运镜，画面流畅自然',
    '细腻人物面部微表情，真实肢体动作，环境光影统一，镜头衔接自然',
    '严格继承上一镜末尾的人物站位、身体朝向、视线方向、手持道具、道具朝向和接触点；除非镜头文字明确写出移动、转向、放下或移开的动作过程，否则不得改变',
    `画面比例 ${aspectRatio}，${shotCountText}，总时长 ${totalDuration}s`,
  ].join('，')

  const timelineLines: string[] = []
  if (shots.length > 0) {
    let cursor = 0
    for (const shot of shots) {
      const start = cursor
      const end = cursor + shot.durationSeconds
      cursor = end
      timelineLines.push(
        `${shot.shotNumber}.【${start}-${end} 秒｜分镜 ${shot.shotNumber}】${attachReferenceLabels(shot.text, references)}`
      )
    }
  } else {
    timelineLines.push(`1.【0-${totalDuration} 秒｜完整片段】${attachReferenceLabels(segment.prompt, references)}`)
  }

  return [
    '整体基础提示（全局通用）',
    basePrompt,
    '',
    `分段时序提示（按镜头时间拆分，对应 ${timelineLines.length} 个分镜）`,
    '每个分镜都从上一分镜的动作落点继续，重点保持手部动作、手持物、道具朝向、接触身体/桌面的位置和环境状态一致。',
    ...timelineLines,
    '',
    '负面提示词（规避劣质画面）',
    NEGATIVE_VIDEO_PROMPT,
  ].join('\n')
}

export default async function postGenerateSegmentVideo(app: FastifyInstance): Promise<void> {
  const BASE_URL = process.env.AVATAR_UPLOAD_BASE_URL ?? process.env.AI_UPLOAD_BASE_URL ?? ''

  function toPublicUrl(url: string): string {
    if (url.startsWith('http://')) {
      return `${BASE_URL}/api/v1/assets/proxy?token=${encryptProxyUrl(url)}`
    }
    if (url.startsWith('/')) {
      return `${BASE_URL}${url}`
    }
    return url
  }

  app.post<{
    Params: { id: string; episodeNumber: string; segmentId: string }
    Body: GenerateSegmentVideoBody
  }>(
    '/short-drama/projects/:id/episodes/:episodeNumber/segments/:segmentId/generate-video',
    {
      schema: {
        params: {
          type: 'object',
          required: ['id', 'episodeNumber', 'segmentId'],
          properties: {
            id: { type: 'string', format: 'uuid' },
            episodeNumber: { type: 'string' },
            segmentId: { type: 'string' },
          },
        },
        body: {
          type: 'object',
          properties: {
            model: { type: 'string', maxLength: 100 },
            resolution: { type: 'string', enum: ['720p', '1080p'] },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const { id: projectId, episodeNumber: epNumStr, segmentId } = request.params
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

      const episode = state.episodes.items.find(ep => ep.episodeNumber === episodeNumber)
      if (!episode) {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: `第 ${episodeNumber} 集不存在` },
        })
      }

      const segment = episode.segments.find(s => s.id === segmentId)
      if (!segment) {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: '分镜不存在' },
        })
      }

      if (segment.status === 'pending' || segment.status === 'generating') {
        return reply.status(409).send({
          success: false,
          error: { code: 'ALREADY_GENERATING', message: '该分镜已在生成中' },
        })
      }

      const modelCode = request.body.model ?? SHORT_DRAMA_VIDEO_MODEL
      const resolution = request.body.resolution ?? '720p'
      const isSeedance = modelCode.startsWith('seedance-')
      const isSeedance2 = modelCode === 'seedance-2.0' || modelCode === 'seedance-2.0-fast'
      const durationSeconds = segment.durationSeconds

      // 校验时长
      if (isSeedance) {
        const allowed = isSeedance2 ? SEEDANCE_2_ALLOWED_DURATIONS : SEEDANCE_ALLOWED_DURATIONS
        try {
          validateShortDramaDuration(durationSeconds, allowed)
        } catch (err) {
          const msg = err instanceof Error ? err.message : '时长不合法'
          return reply.status(400).send({
            success: false,
            error: { code: 'INVALID_DURATION', message: msg },
          })
        }
      }

      // 解析 mentionRefs → 图片 URL，并按 <图N> 注入最终视频提示词
      const promptReferences = buildPromptReferences(segment, state.assets.items, toPublicUrl)
      const imageReferences = promptReferences.map(reference => reference.imageUrl)
      const finalVideoPrompt = buildShortDramaFinalVideoPrompt({
        segment,
        assets: state.assets.items,
        references: promptReferences,
        aspectRatio: state.settings.aspectRatio,
      })

      // 查找视频模型
      const db = getDb()
      const modelRecord = await db
        .selectFrom('provider_models')
        .innerJoin('providers', 'providers.id', 'provider_models.provider_id')
        .select([
          'provider_models.id as modelId',
          'provider_models.credit_cost',
          'provider_models.params_pricing',
          'provider_models.category_references',
          'providers.code as providerCode',
        ])
        .where('provider_models.code', '=', modelCode)
        .where('provider_models.is_active', '=', true)
        .where('providers.is_active', '=', true)
        .executeTakeFirst()

      if (!modelRecord) {
        return reply.status(400).send({
          success: false,
          error: { code: 'MODEL_NOT_FOUND', message: `视频模型 "${modelCode}" 未找到或已停用` },
        })
      }

      if (!parseCategoryReferences(modelRecord.category_references).multimodal) {
        return reply.status(400).send({
          success: false,
          error: { code: 'MODEL_NOT_SUPPORTED', message: `视频模型 "${modelCode}" 不支持全能参考生成` },
        })
      }

      const { unitPrice } = resolveUnitPrice(modelRecord.params_pricing, resolution, modelRecord.credit_cost)
      const totalCost = isSeedance ? durationSeconds * unitPrice : unitPrice

      // 冻结积分
      let creditAccountId: string
      try {
        const result = await freezeCredits(teamId, userId, totalCost)
        creditAccountId = result.creditAccountId
      } catch (err) {
        const msg = err instanceof Error ? err.message : '积分不足'
        return reply.status(402).send({
          success: false,
          error: { code: 'INSUFFICIENT_CREDITS', message: msg },
        })
      }

      const sourceMetadata = makeShortDramaSourceMetadata({
        projectId: project.id,
        episodeId: String(episodeNumber),
        segmentId,
      })

      const aspectRatio = state.settings.aspectRatio
      const videoParams: Record<string, unknown> = {
        aspect_ratio: aspectRatio,
        duration: durationSeconds,
        resolution,
        generate_audio: true,
        source: 'short_drama',
        reference_images: imageReferences,
      }

      // 创建 batch + task (status=pending)
      let batchId: string
      let taskId: string
      try {
        const result = await db.transaction().execute(async (trx) => {
          const batch = await trx
            .insertInto('task_batches')
            .values({
              user_id: userId,
              team_id: teamId,
              workspace_id: project.workspace_id,
              credit_account_id: creditAccountId,
              idempotency_key: randomUUID(),
              source: 'studio',
              module: 'video',
              provider: modelRecord.providerCode,
              model: modelCode,
              prompt: finalVideoPrompt,
              params: JSON.stringify(videoParams),
              quantity: 1,
              status: 'pending',
              estimated_credits: totalCost,
              short_drama_project_id: project.id,
              short_drama_episode_id: String(episodeNumber),
              short_drama_segment_id: segmentId,
            } as any)
            .returning('id')
            .executeTakeFirstOrThrow()

          const task = await trx
            .insertInto('tasks')
            .values({
              batch_id: batch.id,
              user_id: userId,
              version_index: 0,
              estimated_credits: totalCost,
              status: 'pending',
            })
            .returning('id')
            .executeTakeFirstOrThrow()

          return { batchId: batch.id, taskId: task.id }
        })
        batchId = result.batchId
        taskId = result.taskId
      } catch (err) {
        app.log.error({ err }, 'Failed to create segment video batch')
        return reply.status(500).send({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: '任务创建失败' },
        })
      }

      // 入队到 video-queue，由 worker 处理
      try {
        await getVideoQueue().add('video-submit', {
          taskId,
          batchId,
          userId,
          teamId,
          creditAccountId,
          provider: modelRecord.providerCode,
          model: modelCode,
          prompt: finalVideoPrompt,
          params: videoParams,
          estimatedCredits: totalCost,
        })

        // 更新 segment 状态为 generating，并让该集旧导出失效
        segment.videoUrl = null
        segment.status = 'generating'
        ;(segment as ShortDramaSegmentVideoState).videoBatchId = batchId
        ;(segment as ShortDramaSegmentVideoState).videoTaskId = taskId
        invalidateShortDramaEpisodeExports(state, episodeNumber)
        await db
          .updateTable('short_drama_projects')
          .set({
            state: JSON.stringify(state),
            updated_at: new Date(),
          })
          .where('id', '=', project.id)
          .execute()

        app.log.info({ taskId, batchId }, 'Short drama video task enqueued')
      } catch (err) {
        app.log.error({ err, taskId, batchId }, 'Failed to enqueue video task')
        return reply.status(500).send({
          success: false,
          error: { code: 'QUEUE_ERROR', message: '任务入队失败' },
        })
      }

      return reply.status(201).send({
        success: true,
        batchId,
        taskId,
        estimatedCredits: totalCost,
        state,
      })
    }
  )
}
