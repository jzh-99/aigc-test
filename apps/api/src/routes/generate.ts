import type { FastifyInstance } from 'fastify'
import { getDb } from '@aigc/db'
import type { GenerateImageRequest, BatchResponse, TaskResponse } from '@aigc/types'
import { checkPrompt } from '../services/prompt-filter.js'
import { freezeCredits, refundCredits } from '../services/credit.js'
import { getImageQueue } from '../lib/queue.js'
import { decryptProxyUrl } from '../lib/storage.js'
import rateLimit from '@fastify/rate-limit'

// Max pending/processing batches per user
const MAX_PENDING_BATCHES = 20

// Allowed params keys for image generation (whitelist approach)
const ALLOWED_PARAM_KEYS = new Set([
  'aspect_ratio', 'width', 'height', 'seed', 'style', 'quality',
  'image', 'image_url', 'reference_image', 'negative_prompt',
  'steps', 'cfg_scale', 'guidance_scale', 'scheduler',
  // Volcengine Seedream params
  'resolution', 'watermark',
])

// Keys that may contain image data (data URIs or URLs) — must NOT be truncated
const IMAGE_DATA_KEYS = new Set(['image', 'image_url', 'reference_image'])

/** Sanitize params: only allow known keys, validate types, filter text fields */
function sanitizeParams(raw: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (!ALLOWED_PARAM_KEYS.has(key)) continue
    const isImageKey = IMAGE_DATA_KEYS.has(key)
    // String values: truncate to 2000 chars (except image data keys)
    if (typeof value === 'string') {
      sanitized[key] = isImageKey ? value : value.slice(0, 2000)
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      sanitized[key] = value
    } else if (Array.isArray(value)) {
      // Arrays (e.g. reference images): allow up to 5 items, truncate strings (except image data)
      sanitized[key] = value.slice(0, 10).map(v =>
        typeof v === 'string' && !isImageKey ? v.slice(0, 2000) : v
      )
    }
    // Drop objects and other complex types
  }
  return sanitized
}

const PROXY_URL_PREFIX = '/api/v1/assets/proxy?token='

/**
 * Resolve proxy URLs in params.image back to real URLs so AI workers can access them.
 * Asset nodes store /api/v1/assets/proxy?token=... which is an internal-only address.
 */
function resolveProxyUrls(params: Record<string, unknown>): Record<string, unknown> {
  const images = params.image
  if (!Array.isArray(images) || images.length === 0) return params
  const resolved = images.map((url) => {
    if (typeof url !== 'string' || !url.startsWith(PROXY_URL_PREFIX)) return url
    const token = url.slice(PROXY_URL_PREFIX.length)
    return decryptProxyUrl(token) ?? url
  })
  return { ...params, image: resolved }
}

export async function generateRoutes(app: FastifyInstance): Promise<void> {
  // Per-user rate limit on generation: 10 requests per minute
  await app.register(rateLimit, {
    max: 10,
    timeWindow: '1 minute',
    keyGenerator: (request) => `generate:${request.user?.id ?? request.ip}`,
    errorResponseBuilder: (_request, context) => ({
      statusCode: 429,
      success: false,
      error: { code: 'RATE_LIMITED', message: `生成请求过于频繁，请 ${Math.ceil(context.ttl / 1000)} 秒后再试` },
    }),
  })

  app.post<{ Body: GenerateImageRequest }>('/generate/image', {
    schema: {
      body: {
        type: 'object',
        required: ['idempotency_key', 'model', 'prompt', 'workspace_id'],
        properties: {
          idempotency_key: { type: 'string', minLength: 1, maxLength: 128 },
          model: { type: 'string', minLength: 1, maxLength: 100 },
          prompt: { type: 'string', minLength: 1, maxLength: 15000 },
          quantity: { type: 'integer', minimum: 1, maximum: 5, default: 1 },
          workspace_id: { type: 'string', format: 'uuid' },
          params: { type: 'object', default: {} },
          canvas_id: { type: 'string', format: 'uuid' },
          canvas_node_id: { type: 'string', maxLength: 128 },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const { idempotency_key, model, prompt, quantity = 1, params: rawParams = {}, workspace_id: workspaceId, canvas_id, canvas_node_id } = request.body

    // Sanitize params: whitelist keys, validate types
    const params = resolveProxyUrls(sanitizeParams(rawParams))

    // Strip image data from params stored in DB — base64 data URIs can be
    // hundreds of MB and make every batch read/write extremely slow.
    // The full params (including images) are still passed to the BullMQ job
    // so the worker can use them for generation.
    const { image: _imageData, ...paramsForDb } = params as Record<string, unknown> & { image?: unknown }

    const db = getDb()

    const userId = request.user.id

    // Check pending batch limit to prevent queue flooding
    const pendingCount = await db
      .selectFrom('task_batches')
      .select(db.fn.count('id').as('count'))
      .where('user_id', '=', userId)
      .where('status', 'in', ['pending', 'processing'])
      .executeTakeFirstOrThrow()

    if (Number(pendingCount.count) >= MAX_PENDING_BATCHES) {
      return reply.status(429).send({
        success: false,
        error: { code: 'TOO_MANY_PENDING', message: `您有 ${pendingCount.count} 个任务正在处理中，请等待完成后再提交新任务（上限 ${MAX_PENDING_BATCHES}）` },
      })
    }

    // Verify user is a workspace member with at least 'editor' role
    const wsMember = await db
      .selectFrom('workspace_members')
      .innerJoin('workspaces', 'workspaces.id', 'workspace_members.workspace_id')
      .select(['workspaces.team_id', 'workspace_members.role'])
      .where('workspace_members.workspace_id', '=', workspaceId)
      .where('workspace_members.user_id', '=', userId)
      .executeTakeFirst()

    // Admin users bypass workspace membership check
    if (!wsMember && request.user.role !== 'admin') {
      return reply.status(403).send({
        success: false,
        error: { code: 'FORBIDDEN', message: '你不是此工作区的成员' },
      })
    }

    if (wsMember && wsMember.role === 'viewer' && request.user.role !== 'admin') {
      return reply.status(403).send({
        success: false,
        error: { code: 'FORBIDDEN', message: '查看者无权生成图片' },
      })
    }

    // Look up team via workspace
    let teamId: string
    if (wsMember) {
      teamId = wsMember.team_id
    } else {
      // Admin user — look up team directly
      const workspace = await db
        .selectFrom('workspaces')
        .select('team_id')
        .where('id', '=', workspaceId)
        .executeTakeFirst()
      if (!workspace) return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: '工作区未找到' },
      })
      teamId = workspace.team_id
    }

    // Ensure user is a team member (required for credit tracking)
    const teamMember = await db
      .selectFrom('team_members')
      .select(['user_id', 'priority_boost'])
      .where('team_id', '=', teamId)
      .where('user_id', '=', userId)
      .executeTakeFirst()

    if (!teamMember) {
      return reply.status(403).send({
        success: false,
        error: { code: 'FORBIDDEN', message: '必须是团队成员才能生成图片' },
      })
    }

    // Priority: admin or priority_boost users get highest priority (1), others get default (10)
    const isHighPriority = request.user.role === 'admin' || teamMember.priority_boost === true
    const jobPriority = isHighPriority ? 1 : 10

    // Idempotency check
    const existing = await db
      .selectFrom('task_batches')
      .selectAll()
      .where('idempotency_key', '=', idempotency_key)
      .where('user_id', '=', userId)
      .executeTakeFirst()

    if (existing) {
      // Return existing batch
      const tasks = await db
        .selectFrom('tasks')
        .selectAll()
        .where('batch_id', '=', existing.id)
        .execute()

      return reply.send({
        id: existing.id,
        module: existing.module,
        provider: existing.provider,
        model: existing.model,
        prompt: existing.prompt,
        params: existing.params,
        quantity: existing.quantity,
        completed_count: existing.completed_count,
        failed_count: existing.failed_count,
        status: existing.status,
        estimated_credits: existing.estimated_credits,
        actual_credits: existing.actual_credits,
        created_at: existing.created_at.toISOString?.() ?? String(existing.created_at),
        tasks: tasks.map((t: any) => ({
          id: t.id,
          version_index: t.version_index,
          status: t.status,
          estimated_credits: t.estimated_credits,
          credits_cost: t.credits_cost,
          error_message: t.error_message,
          processing_started_at: t.processing_started_at?.toISOString?.() ?? t.processing_started_at ?? null,
          completed_at: t.completed_at?.toISOString?.() ?? t.completed_at ?? null,
          asset: null,
        })),
      })
    }

    // Prompt filter check (also check negative_prompt if present)
    const filterResult = await checkPrompt(userId, prompt)
    if (!filterResult.allowed) {
      return reply.status(403).send({
        success: false,
        error: {
          code: 'PROMPT_BLOCKED',
          message: `Prompt blocked by filter rule: ${filterResult.ruleLabel}`,
        },
      })
    }
    if (typeof params.negative_prompt === 'string' && params.negative_prompt.length > 0) {
      const negFilter = await checkPrompt(userId, params.negative_prompt)
      if (!negFilter.allowed) {
        return reply.status(403).send({
          success: false,
          error: {
            code: 'PROMPT_BLOCKED',
            message: `Negative prompt blocked by filter rule: ${negFilter.ruleLabel}`,
          },
        })
      }
    }

    // Lookup model
    const providerModel = await db
      .selectFrom('provider_models')
      .innerJoin('providers', 'providers.id', 'provider_models.provider_id')
      .select([
        'provider_models.id as modelId',
        'provider_models.credit_cost',
        'providers.code as providerCode',
        'providers.id as providerId',
      ])
      .where('provider_models.code', '=', model)
      .where('provider_models.is_active', '=', true)
      .where('providers.is_active', '=', true)
      .executeTakeFirst()

    if (!providerModel) {
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: `模型 "${model}" 未找到或已停用` },
      })
    }

    const totalCost = providerModel.credit_cost * quantity

    // Freeze credits
    let creditAccountId: string
    try {
      const result = await freezeCredits(teamId, userId, totalCost)
      creditAccountId = result.creditAccountId
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Credit error'
      return reply.status(402).send({
        success: false,
        error: { code: 'INSUFFICIENT_CREDITS', message: msg },
      })
    }

    // Create batch + tasks in transaction, then enqueue
    // If either step fails after freeze, refund to prevent orphan frozen credits
    let batch: { batch: any; tasks: any[] }
    try {
      batch = await db.transaction().execute(async (trx: any) => {
        const batchResult = await trx
          .insertInto('task_batches')
          .values({
            user_id: userId,
            team_id: teamId,
            workspace_id: workspaceId,
            credit_account_id: creditAccountId,
            idempotency_key,
            module: 'image',
            provider: providerModel.providerCode,
            model,
            prompt,
            params: JSON.stringify(paramsForDb),
            quantity,
            status: 'pending',
            estimated_credits: totalCost,
            ...(canvas_id ? { canvas_id, canvas_node_id: canvas_node_id ?? null } : {}),
          })
          .returningAll()
          .executeTakeFirstOrThrow()

        const taskValues = Array.from({ length: quantity }, (_, i) => ({
          batch_id: batchResult.id,
          user_id: userId,
          version_index: i,
          estimated_credits: providerModel.credit_cost,
          status: 'pending' as const,
        }))

        const tasks = await trx
          .insertInto('tasks')
          .values(taskValues)
          .returningAll()
          .execute()

        return { batch: batchResult, tasks }
      })

      // Enqueue BullMQ jobs
      for (const task of batch.tasks) {
        await getImageQueue().add('generate', {
          taskId: task.id,
          batchId: batch.batch.id,
          userId,
          teamId,
          creditAccountId,
          provider: providerModel.providerCode,
          model,
          prompt,
          params,
          estimatedCredits: providerModel.credit_cost,
          ...(canvas_id ? { canvasId: canvas_id, canvasNodeId: canvas_node_id ?? undefined } : {}),
        }, { priority: jobPriority })
      }
    } catch (err) {
      // DB or queue error after freeze — refund to prevent orphan frozen credits
      app.log.error({ err }, 'Failed to create batch/tasks after freeze, refunding credits')
      try {
        await refundCredits(teamId, creditAccountId, userId, totalCost)
      } catch (refundErr) {
        app.log.error({ refundErr }, 'CRITICAL: Failed to refund credits after batch creation failure')
      }
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: '任务创建失败，积分已退回，请重试' },
      })
    }

    // Return response
    return reply.status(201).send({
      id: batch.batch.id,
      module: 'image',
      provider: providerModel.providerCode,
      model,
      prompt,
      params: paramsForDb,
      quantity,
      completed_count: 0,
      failed_count: 0,
      status: 'pending',
      estimated_credits: totalCost,
      actual_credits: 0,
      created_at: batch.batch.created_at.toISOString?.() ?? String(batch.batch.created_at),
      tasks: batch.tasks.map((t: any) => ({
        id: t.id,
        version_index: t.version_index,
        status: t.status,
        estimated_credits: t.estimated_credits,
        credits_cost: null,
        error_message: null,
        processing_started_at: null,
        completed_at: null,
        asset: null,
      })),
    })
  })
}
