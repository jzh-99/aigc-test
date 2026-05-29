import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from 'fastify'
import { getDb } from '@aigc/db'
import { type PictureBookState } from '@aigc/types'
import { randomUUID } from 'node:crypto'
import { sql } from 'kysely'
import { assertPictureBookProjectAccess, jsonbArray, PICTURE_BOOK_MODELS } from './_shared.js'

type AssetTargetKind = 'character' | 'background'
type RequestedTarget = { kind: AssetTargetKind; ref_id: string }
type ResolvedTarget = { kind: AssetTargetKind; refId: string; name: string; prompt: string }

export function makePictureBookImageParams(projectId: string, refId: string, style: string, aspectRatio = '16:9'): Record<string, unknown> {
  return {
    resolution: '2K',
    aspect_ratio: aspectRatio,
    watermark: false,
    style,
    seed: stableSeed(`${projectId}:${refId}`),
  }
}

export function selectAssetTargets(state: PictureBookState, targets?: RequestedTarget[]): ResolvedTarget[] {
  const allTargets: ResolvedTarget[] = [
    ...state.assets.characters.map(item => ({ kind: 'character' as const, refId: item.id, name: item.name, prompt: item.prompt })),
    ...state.assets.backgrounds.map(item => ({ kind: 'background' as const, refId: item.id, name: item.name, prompt: item.prompt })),
  ].filter(item => item.prompt.trim())

  if (!targets?.length) return allTargets
  const requested = new Set(targets.map(target => `${target.kind}:${target.ref_id}`))
  return allTargets.filter(target => requested.has(`${target.kind}:${target.refId}`))
}

async function injectJson(app: FastifyInstance, request: FastifyRequest, url: string, payload: unknown) {
  const response = await (app.inject as any)({
    method: 'POST',
    url,
    headers: request.headers.authorization ? { authorization: request.headers.authorization } : {},
    payload: payload as any,
  })
  const body = response.json() as any
  if (response.statusCode >= 400) {
    app.log.error({ url, statusCode: response.statusCode, body }, 'injectJson failed')
    throw new Error(body?.error?.message ?? `request failed: ${response.statusCode}`)
  }
  return body
}

async function recordImageBatch(input: {
  projectId: string
  workspaceId: string
  teamId: string
  userId: string
  target: ResolvedTarget
  batch: any
}) {
  const estimatedCredits = Number(input.batch.estimated_credits ?? 0)
  await getDb().transaction().execute(async (trx) => {
    await trx
      .updateTable('task_batches')
      .set({ picture_book_project_id: input.projectId })
      .where('id', '=', input.batch.id)
      .execute()

    await trx
      .insertInto('picture_book_project_assets')
      .values({
        project_id: input.projectId,
        kind: input.target.kind,
        ref_id: input.target.refId,
        name: input.target.name,
        prompt: input.target.prompt,
        batch_id: input.batch.id,
        status: 'pending',
        metadata: JSON.stringify({ model: PICTURE_BOOK_MODELS.image }),
      })
      .onConflict((oc) =>
        oc.columns(['project_id', 'kind', 'ref_id']).doUpdateSet({
          name: input.target.name,
          prompt: input.target.prompt,
          batch_id: input.batch.id,
          status: 'pending',
          selected_asset_url: null,
          selected_asset_id: null,
          metadata: JSON.stringify({ model: PICTURE_BOOK_MODELS.image }) as any,
          updated_at: sql`now()`,
        }),
      )
      .execute()

    await trx
      .insertInto('picture_book_project_charges')
      .values({
        project_id: input.projectId,
        workspace_id: input.workspaceId,
        team_id: input.teamId,
        user_id: input.userId,
        charge_type: 'project',
        model: PICTURE_BOOK_MODELS.image,
        target_count: 1,
        estimated_credits: estimatedCredits,
        actual_credits: null,
        status: 'processing',
        batch_ids: jsonbArray([input.batch.id]),
        metadata: JSON.stringify({ operation: 'asset_image', kind: input.target.kind, ref_id: input.target.refId }),
      })
      .execute()

    await trx
      .updateTable('picture_book_projects')
      .set({
        estimated_credits: sql`estimated_credits + ${estimatedCredits}`,
        updated_at: sql`now()`,
      })
      .where('id', '=', input.projectId)
      .execute()
  })
}

const route: FastifyPluginAsync = async (app) => {
  app.post<{ Body: { project_id: string; targets?: RequestedTarget[]; params?: Record<string, unknown> } }>(
    '/picture-book/generate-assets',
    {
      schema: {
        body: {
          type: 'object',
          required: ['project_id'],
          properties: {
            project_id: { type: 'string', format: 'uuid' },
            targets: { type: 'array', items: { type: 'object' } },
            params: { type: 'object' },
          },
        },
      },
    },
    async (request, reply) => {
      const access = await assertPictureBookProjectAccess(request.body.project_id, request.user.id, true)
      if (!access) return reply.status(404).send({ error: { code: 'PROJECT_NOT_FOUND', message: '绘本项目不存在' } })

      const targets = selectAssetTargets(access.state, request.body.targets)
      if (!targets.length) return reply.status(400).send({ error: { code: 'NO_TARGETS', message: '没有可生成的角色或背景提示词' } })

      const batches: any[] = []
      const failures: Array<{ ref_id: string; message: string }> = []
      for (const target of targets) {
        try {
          const batch = await injectJson(app, request, '/api/v1/generate/image', {
            idempotency_key: `picture_book_${request.body.project_id}_${target.kind}_${target.refId}_${randomUUID()}`,
            model: PICTURE_BOOK_MODELS.image,
            prompt: target.prompt,
            quantity: 1,
            workspace_id: access.workspaceId,
            params: {
              ...makePictureBookImageParams(request.body.project_id, target.refId, access.style, access.state.settings.aspectRatio ?? '16:9'),
              ...(request.body.params ?? {}),
            },
          })
          await recordImageBatch({
            projectId: request.body.project_id,
            workspaceId: access.workspaceId,
            teamId: access.teamId,
            userId: request.user.id,
            target,
            batch,
          })
          batches.push({ ref_id: target.refId, kind: target.kind, batch_id: batch.id, status: batch.status })
        } catch (error) {
          failures.push({ ref_id: target.refId, message: error instanceof Error ? error.message : String(error) })
        }
      }

      return reply.send({ success: failures.length === 0, batches, failures })
    },
  )
}

function stableSeed(input: string): number {
  let hash = 2166136261
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return Math.abs(hash % 2147483647)
}

export default route
