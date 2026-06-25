import type { FastifyPluginAsync, FastifyInstance } from 'fastify'
import { getDb } from '@aigc/db'
import { randomUUID } from 'node:crypto'
import type { CategoryReferences, GenerateImageRequest, ParamsPricingRule } from '@aigc/types'
import { parseCategoryReferences, resolveImageGenerationCategory, validateImageReferenceLimits } from '@aigc/types'
import { checkPrompt } from '../../services/prompt-filter.js'
import { freezeCredits, refundCredits } from '../../services/credit.js'
import { getImageQueue } from '../../lib/queue.js'
import { decryptProxyUrl, uploadToTos } from '../../lib/storage.js'
import { resolveUnitPrice } from '../../lib/pricing.js'
import { resolveBatchSource } from '../../lib/batch-source.js'
import rateLimit from '@fastify/rate-limit'
import {
  deductBizMgmtPointsForGeneration,
  getCurrentBizMgmtIdentity,
} from '../../services/biz-mgmt-a-bean.js'

// 每个用户最多同时处于 pending/processing 状态的批次数
const MAX_PENDING_BATCHES = 20
const MAX_IMAGE_REFERENCE_PARAMS = 14

const FALLBACK_CATEGORY_REFERENCES: CategoryReferences = {
  text_to_image: {
    label: '文生图',
    limits: {
        image: { min: 0, max: 0 },
        video: { min: 0, max: 0 },
        audio: { min: 0, max: 0 },
        text: { min: 0, max: 0 },
    },
  },
  image_to_image: {
    label: '图生图',
    limits: {
        image: { min: 0, max: 10 },
        video: { min: 0, max: 0 },
        audio: { min: 0, max: 0 },
        text: { min: 0, max: 0 },
    },
  },
}

function findPricingRuleByModel(paramsPricing: unknown, model: string): ParamsPricingRule | null {
  if (!Array.isArray(paramsPricing)) return null
  return paramsPricing.find(
    (rule): rule is ParamsPricingRule =>
      typeof rule === 'object' &&
      rule !== null &&
      (rule as ParamsPricingRule).model === model &&
      typeof (rule as ParamsPricingRule).resolution === 'string' &&
      typeof (rule as ParamsPricingRule).unit_price === 'number',
  ) ?? null
}

// 图片生成允许的 params 键白名单
const ALLOWED_PARAM_KEYS = new Set([
  'aspect_ratio', 'width', 'height', 'seed', 'style', 'quality',
  'image', 'image_url', 'reference_image', 'negative_prompt',
  'steps', 'cfg_scale', 'guidance_scale', 'scheduler',
  'reference_image_urls',
  // 火山引擎 Seedream 参数
  'resolution', 'watermark',
])

// 可能包含图片数据（data URI 或 URL）的键，不做截断
const IMAGE_DATA_KEYS = new Set(['image', 'image_url', 'reference_image'])

/** 清洗 params：只保留白名单键，校验类型，过滤文本字段 */
function sanitizeParams(raw: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (!ALLOWED_PARAM_KEYS.has(key)) continue
    const isImageKey = IMAGE_DATA_KEYS.has(key)
    if (typeof value === 'string') {
      sanitized[key] = isImageKey ? value : value.slice(0, 2000)
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      sanitized[key] = value
    } else if (Array.isArray(value)) {
      // 数组（如参考图）：最多保留平台支持的最大参考图数量，字符串截断（图片数据键除外）
      sanitized[key] = value.slice(0, MAX_IMAGE_REFERENCE_PARAMS).map(v =>
        typeof v === 'string' && !isImageKey ? v.slice(0, 2000) : v
      )
    }
    // 丢弃对象及其他复杂类型
  }
  return sanitized
}

/** 记录生成提交错误到 submission_errors 表 */
function logGenerateSubmissionError(
  app: FastifyInstance,
  payload: {
    userId: string
    errorCode: string
    httpStatus: number | null
    detail?: string | null
    model?: string | null
    canvasId?: string | null
  },
): void {
  getDb().insertInto('submission_errors').values({
    user_id: payload.userId,
    source: 'generate_api',
    error_code: payload.errorCode,
    http_status: payload.httpStatus,
    detail: payload.detail ? payload.detail.slice(0, 1000) : null,
    model: payload.model ?? null,
    canvas_id: payload.canvasId ?? null,
  }).execute().catch((err) => {
    app.log.warn({ err, errorCode: payload.errorCode }, 'Failed to log submission error')
  })
}

const PROXY_URL_PREFIX = '/api/v1/assets/proxy?token='

/**
 * 将 params.image 中的代理 URL 还原为真实 URL，
 * 以便 AI worker 能够访问。
 * 资产节点存储的是 /api/v1/assets/proxy?token=... 内部地址。
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

function countImageReferences(rawParams: Record<string, unknown>): number {
  const images = rawParams.image
  return Array.isArray(images) ? images.length : 0
}

function parseDataUrlImage(value: string): { buffer: Buffer; contentType: string; ext: string } | null {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(value)
  if (!match) return null
  const contentType = match[1]
  const ext = contentType.split('/')[1]?.replace('jpeg', 'jpg') ?? 'jpg'
  return {
    buffer: Buffer.from(match[2], 'base64'),
    contentType,
    ext,
  }
}

async function persistReferenceImageUrls(params: Record<string, unknown>): Promise<string[]> {
  const existing = Array.isArray(params.reference_image_urls)
    ? params.reference_image_urls.filter((url): url is string => typeof url === 'string' && url.length > 0)
    : []
  if (existing.length > 0) return existing

  const images = Array.isArray(params.image)
    ? params.image.filter((url): url is string => typeof url === 'string' && url.length > 0)
    : []
  if (images.length === 0) return []

  const urls: string[] = []
  for (const image of images.slice(0, MAX_IMAGE_REFERENCE_PARAMS)) {
    const parsed = parseDataUrlImage(image)
    if (!parsed) {
      urls.push(image)
      continue
    }
    const key = `generation-references/${randomUUID()}.${parsed.ext}`
    urls.push(await uploadToTos(key, parsed.buffer, parsed.contentType))
  }
  return urls
}

const route: FastifyPluginAsync = async (app) => {
  // 每用户生成限速：每分钟 30 次
  await app.register(rateLimit, {
    max: 30,
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
          video_studio_project_id: { type: 'string', format: 'uuid' },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const { idempotency_key, model, prompt, quantity = 1, params: rawParams = {}, workspace_id: workspaceId, canvas_id, canvas_node_id, video_studio_project_id } = request.body as any

    if (canvas_id && canvas_node_id) {
      app.log.info({
        idempotencyKey: idempotency_key,
        canvasId: canvas_id,
        canvasNodeId: canvas_node_id,
        prompt,
      }, 'Canvas image generate request received')
    }

    // 清洗 params：白名单键 + 类型校验
    const imageReferenceCount = countImageReferences(rawParams)
    const params = resolveProxyUrls(sanitizeParams(rawParams))
    const { reference_image_urls: _referenceImageUrls, ...paramsForJob } =
      params as Record<string, unknown> & { reference_image_urls?: unknown }
    let paramsForDb: Record<string, unknown> = {}

    const db = getDb()
    const userId = request.user.id

    // 检查 pending 批次上限，防止队列被刷爆
    const pendingCount = await db
      .selectFrom('task_batches')
      .select(db.fn.count('id').as('count'))
      .where('user_id', '=', userId)
      .where('status', 'in', ['pending', 'processing'])
      .executeTakeFirstOrThrow()

    if (Number(pendingCount.count) >= MAX_PENDING_BATCHES) {
      logGenerateSubmissionError(app, {
        userId,
        errorCode: 'TOO_MANY_PENDING',
        httpStatus: 429,
        detail: `pending_count=${pendingCount.count}`,
        model,
        canvasId: canvas_id,
      })
      return reply.status(429).send({
        success: false,
        error: { code: 'TOO_MANY_PENDING', message: `您有 ${pendingCount.count} 个任务正在处理中，请等待完成后再提交新任务（上限 ${MAX_PENDING_BATCHES}）` },
      })
    }

    // 验证用户是否为工作区成员（至少 editor 角色）
    const wsMember = await db
      .selectFrom('workspace_members')
      .innerJoin('workspaces', 'workspaces.id', 'workspace_members.workspace_id')
      .select(['workspaces.team_id', 'workspace_members.role'])
      .where('workspace_members.workspace_id', '=', workspaceId)
      .where('workspace_members.user_id', '=', userId)
      .executeTakeFirst()

    // admin 用户跳过工作区成员检查
    if (!wsMember && request.user.role !== 'admin') {
      logGenerateSubmissionError(app, {
        userId,
        errorCode: 'FORBIDDEN',
        httpStatus: 403,
        detail: 'not_workspace_member',
        model,
        canvasId: canvas_id,
      })
      return reply.status(403).send({
        success: false,
        error: { code: 'FORBIDDEN', message: '你不是此工作区的成员' },
      })
    }

    if (wsMember && wsMember.role === 'viewer' && request.user.role !== 'admin') {
      logGenerateSubmissionError(app, {
        userId,
        errorCode: 'FORBIDDEN',
        httpStatus: 403,
        detail: 'viewer_role',
        model,
        canvasId: canvas_id,
      })
      return reply.status(403).send({
        success: false,
        error: { code: 'FORBIDDEN', message: '查看者无权生成图片' },
      })
    }

    // 通过工作区查找团队
    let teamId: string
    if (wsMember) {
      teamId = wsMember.team_id
    } else {
      // admin 用户 — 直接查工作区
      const workspace = await db
        .selectFrom('workspaces')
        .select('team_id')
        .where('id', '=', workspaceId)
        .executeTakeFirst()
      if (!workspace) {
        logGenerateSubmissionError(app, {
          userId,
          errorCode: 'NOT_FOUND',
          httpStatus: 404,
          detail: 'workspace_not_found',
          model,
          canvasId: canvas_id,
        })
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: '工作区未找到' },
        })
      }
      teamId = workspace.team_id
    }

    // 确认用户是团队成员（积分追踪必须）
    const teamMember = await db
      .selectFrom('team_members')
      .select(['user_id', 'priority_boost'])
      .where('team_id', '=', teamId)
      .where('user_id', '=', userId)
      .executeTakeFirst()

    if (!teamMember) {
      logGenerateSubmissionError(app, {
        userId,
        errorCode: 'FORBIDDEN',
        httpStatus: 403,
        detail: 'not_team_member',
        model,
        canvasId: canvas_id,
      })
      return reply.status(403).send({
        success: false,
        error: { code: 'FORBIDDEN', message: '必须是团队成员才能生成图片' },
      })
    }

    // 优先级：admin 或 priority_boost 用户获得最高优先级(1)，其他默认(10)
    const isHighPriority = request.user.role === 'admin' || teamMember.priority_boost === true
    const jobPriority = isHighPriority ? 1 : 10

    // 幂等性检查
    const existing = await db
      .selectFrom('task_batches')
      .selectAll()
      .where('idempotency_key', '=', idempotency_key)
      .where('user_id', '=', userId)
      .executeTakeFirst()

    if (existing) {
      // 返回已存在的批次
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

    // Prompt 过滤检查（同时检查 negative_prompt）
    const filterResult = await checkPrompt(userId, prompt)
    if (!filterResult.allowed) {
      logGenerateSubmissionError(app, {
        userId,
        errorCode: 'PROMPT_BLOCKED',
        httpStatus: 403,
        detail: filterResult.ruleLabel,
        model,
        canvasId: canvas_id,
      })
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
        logGenerateSubmissionError(app, {
          userId,
          errorCode: 'PROMPT_BLOCKED',
          httpStatus: 403,
          detail: `negative_prompt:${negFilter.ruleLabel}`,
          model,
          canvasId: canvas_id,
        })
        return reply.status(403).send({
          success: false,
          error: {
            code: 'PROMPT_BLOCKED',
            message: `Negative prompt blocked by filter rule: ${negFilter.ruleLabel}`,
          },
        })
      }
    }

    // 查找模型：优先按 provider_models.code 命中；画布可能直接提交 params_pricing.model，
    // 此时回退到 pricing 规则归属的 provider model，再继续做权限、计费和入队。
    let pricingModelRule: ParamsPricingRule | null = null
    let providerModel = await db
      .selectFrom('provider_models')
      .innerJoin('providers', 'providers.id', 'provider_models.provider_id')
      .select([
        'provider_models.id as modelId',
        'provider_models.code as modelCode',
        'provider_models.params_pricing',
        'provider_models.category_references',
        'providers.code as providerCode',
        'providers.id as providerId',
      ])
      .where('provider_models.code', '=', model)
      .where('provider_models.is_active', '=', true)
      .where('providers.is_active', '=', true)
      .executeTakeFirst()

    if (!providerModel) {
      const activeImageModels = await db
        .selectFrom('provider_models')
        .innerJoin('providers', 'providers.id', 'provider_models.provider_id')
        .select([
          'provider_models.id as modelId',
          'provider_models.code as modelCode',
          'provider_models.params_pricing',
          'provider_models.category_references',
          'providers.code as providerCode',
          'providers.id as providerId',
        ])
        .where('provider_models.module', '=', 'image')
        .where('provider_models.is_active', '=', true)
        .where('providers.is_active', '=', true)
        .execute()

      for (const activeModel of activeImageModels) {
        const matchedRule = findPricingRuleByModel(activeModel.params_pricing, model)
        if (matchedRule) {
          providerModel = activeModel
          pricingModelRule = matchedRule
          break
        }
      }
    }

    if (!providerModel) {
      logGenerateSubmissionError(app, {
        userId,
        errorCode: 'NOT_FOUND',
        httpStatus: 404,
        detail: 'model_not_found_or_inactive',
        model,
        canvasId: canvas_id,
      })
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: `模型 "${model}" 未找到或已停用` },
      })
    }

    const categoryReferences = parseCategoryReferences(providerModel.category_references)
    const effectiveCategoryReferences = Object.keys(categoryReferences).length > 0 ? categoryReferences : FALLBACK_CATEGORY_REFERENCES
    const activeImageCategory = resolveImageGenerationCategory(effectiveCategoryReferences, imageReferenceCount)
    const limitResult = validateImageReferenceLimits(effectiveCategoryReferences, activeImageCategory, imageReferenceCount)
    if (!limitResult.valid) {
      logGenerateSubmissionError(app, {
        userId,
        errorCode: 'INVALID_IMAGE_REFERENCES',
        httpStatus: 400,
        detail: `category=${activeImageCategory};image_count=${imageReferenceCount};message=${limitResult.message ?? ''}`,
        model,
        canvasId: canvas_id,
      })
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_IMAGE_REFERENCES', message: limitResult.message ?? '参考图数量不符合当前模型限制' },
      })
    }

    // 检查团队级别的模型权限（team_model_configs.is_active 优先于全局配置）
    const teamModelConfig = await db
      .selectFrom('team_model_configs')
      .select('is_active')
      .where('team_id', '=', teamId)
      .where('model_id', '=', providerModel.modelId)
      .executeTakeFirst()

    if (teamModelConfig && !teamModelConfig.is_active) {
      logGenerateSubmissionError(app, {
        userId,
        errorCode: 'MODEL_DISABLED',
        httpStatus: 403,
        detail: 'team_model_disabled',
        model,
        canvasId: canvas_id,
      })
      return reply.status(403).send({
        success: false,
        error: { code: 'MODEL_DISABLED', message: `模型 "${model}" 在当前团队中已被禁用` },
      })
    }

    const referenceImageUrls = await persistReferenceImageUrls(params)
    const { image: _imageData, ...paramsForDbBase } = paramsForJob as Record<string, unknown> & { image?: unknown }
    paramsForDb = {
      ...paramsForDbBase,
      ...(referenceImageUrls.length > 0 ? { reference_image_urls: referenceImageUrls } : {}),
    }

    const requestResolution = (params as Record<string, unknown> | undefined)?.resolution as string | undefined
    const resolution = requestResolution ?? pricingModelRule?.resolution
    const { unitPrice, resolvedModel } = resolveUnitPrice(providerModel.params_pricing, resolution)
    // params_pricing 命中时用底层模型 code 替换请求中的 model
    const actualModel = resolvedModel ?? model
    const totalCost = unitPrice * quantity

    // 冻结积分 / 业管 A 豆扣减
    // 分支：有当前业管会员身份 → 走业管 A 豆实时扣减（不读本地余额，不创建本地冻结）；
    //      无业管身份（旧账号/内部账号）→ 走原本地 freezeCredits。
    let creditAccountId: string
    // 业管扣减上下文，仅业管身份任务携带，供 worker 终态写创作结果 outbox
    let bizMgmtBilling: { requestNo: string; bizMgmtUserId: string; workNo: string } | null = null
    let bizMgmtIdentity: Awaited<ReturnType<typeof getCurrentBizMgmtIdentity>> | null = null
    try {
      // 探测当前用户是否已选择业管会员身份（无身份会抛错，落入本地积分分支）
      bizMgmtIdentity = await getCurrentBizMgmtIdentity(userId)
    } catch {
      // 非业管账号：bizMgmtIdentity 保持 null，走本地积分流程
      bizMgmtIdentity = null
    }

    try {
      if (bizMgmtIdentity) {
        // 业管身份：实时查余额 + 扣减（AIHUB_POINTS_CHANGE），扣减失败不创建任务
        // 注意 batch_id 尚未生成，先用临时占位 id 让审计先行；扣减成功后用真实 batch_id。
        // 这里采用「先创建批次→再扣减」的反向，见下方事务内统一处理。
        // 为保持幂等号稳定且可追溯，使用 idempotency_key 作为批次级扣减幂等号。
        const tempBatchId = idempotency_key
        const deduction = await deductBizMgmtPointsForGeneration({
          localUserId: userId,
          teamId,
          workspaceId,
          batchId: tempBatchId,
          pointsNum: totalCost,
          source: 1, // 来源值以业管文档为准；集中在此处，避免散落魔法数字
          remark: `图片生成：${model}`,
        })
        bizMgmtBilling = {
          requestNo: deduction.requestNo,
          bizMgmtUserId: deduction.bizMgmtUserId,
          workNo: deduction.workNo,
        }
        // 业管扣减账号不需要本地 credit_account，但 task_batches.credit_account_id 非空，
        // 复用团队级账户作为归属占位（业管计费权威在 biz_mgmt_a_bean_transactions）。
        const teamAccount = await db
          .selectFrom('credit_accounts')
          .select('id')
          .where('owner_type', '=', 'team')
          .where('team_id', '=', teamId)
          .executeTakeFirstOrThrow()
        creditAccountId = teamAccount.id
      } else {
        // 旧账号/内部账号：本地积分冻结
        const result = await freezeCredits(teamId, userId, totalCost, '图片生成冻结')
        creditAccountId = result.creditAccountId
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Credit error'
      logGenerateSubmissionError(app, {
        userId,
        errorCode: 'INSUFFICIENT_CREDITS',
        httpStatus: 402,
        detail: msg,
        model,
        canvasId: canvas_id,
      })
      return reply.status(402).send({
        success: false,
        error: { code: 'INSUFFICIENT_CREDITS', message: msg },
      })
    }

    // 在事务中创建批次 + 任务，然后入队
    // 若任一步骤在冻结后失败，退还积分防止孤立冻结
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
            source: resolveBatchSource({
              module: 'image',
              canvasId: canvas_id,
              canvasNodeId: canvas_node_id,
              videoStudioProjectId: video_studio_project_id,
            }),
            module: 'image',
            provider: providerModel.providerCode,
            model,
            prompt,
            params: JSON.stringify(paramsForDb),
            quantity,
            status: 'pending',
            estimated_credits: totalCost,
            ...(canvas_id ? { canvas_id, canvas_node_id: canvas_node_id ?? null } : {}),
            ...(video_studio_project_id ? { video_studio_project_id } : {}),
          })
          .returningAll()
          .executeTakeFirstOrThrow()

        const taskValues = Array.from({ length: quantity }, (_, i) => ({
          batch_id: batchResult.id,
          user_id: userId,
          version_index: i,
          estimated_credits: unitPrice,
          status: 'pending' as const,
        }))

        const tasks = await trx
          .insertInto('tasks')
          .values(taskValues)
          .returningAll()
          .execute()

        return { batch: batchResult, tasks }
      })

      // 先构建所有 job payload，再批量入队，避免部分入队导致积分状态不一致
      const jobPayloads = batch.tasks.map((task: any) => ({
        name: 'generate',
        data: {
          taskId: task.id,
          batchId: batch.batch.id,
          userId,
          teamId,
          workspaceId,
          creditAccountId,
          provider: providerModel.providerCode,
          model: actualModel,
          prompt,
          params: paramsForJob,
          estimatedCredits: unitPrice,
          // 业管身份任务携带计费上下文，供 worker 终态写创作结果 outbox
          ...(bizMgmtBilling
            ? {
                bizMgmtDeductRequestNo: bizMgmtBilling.requestNo,
                bizMgmtUserId: bizMgmtBilling.bizMgmtUserId,
                bizMgmtWorkNo: bizMgmtBilling.workNo,
              }
            : {}),
          ...(canvas_id ? { canvasId: canvas_id, canvasNodeId: canvas_node_id ?? undefined } : {}),
        },
        opts: { priority: jobPriority },
      }))
      await getImageQueue().addBulk(jobPayloads)
    } catch (err) {
      // DB 创建或批量入队失败 — 退还全部冻结积分
      // 注意：业管扣减失败已在上方 try 块拦截，不会走到这里；走到这里仅本地积分账号需退款。
      app.log.error({ err }, 'Failed to create batch/tasks after freeze, refunding credits')
      logGenerateSubmissionError(app, {
        userId,
        errorCode: 'INTERNAL_ERROR',
        httpStatus: 500,
        detail: err instanceof Error ? err.message : 'batch_creation_failed',
        model,
        canvasId: canvas_id,
      })
      try {
        if (!bizMgmtBilling) {
          await refundCredits(teamId, creditAccountId, userId, totalCost, undefined, undefined, '图片生成退款')
        }
      } catch (refundErr) {
        app.log.error({ refundErr }, 'CRITICAL: Failed to refund credits after batch creation failure')
      }
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: '任务创建失败，积分已退回，请重试' },
      })
    }

    // 返回响应
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

export default route
