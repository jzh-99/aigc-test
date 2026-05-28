import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'
import { type PictureBookState, type PictureBookStoryboardPage } from '@aigc/types'
import { sql } from 'kysely'
import { assertPictureBookProjectAccess, PICTURE_BOOK_MODELS } from './_shared.js'
import { makePictureBookImageParams } from './post-generate-assets.js'

type RequestedPageTarget = { ref_id: string }
type StoryboardImageTarget = { refId: string; page: number; prompt: string }

export function selectStoryboardImageTargets(state: PictureBookState, targets?: RequestedPageTarget[]): StoryboardImageTarget[] {
  const allTargets = state.storyboard
    .map(page => ({ refId: `page_${page.page}`, page: page.page, prompt: page.prompt }))
    .filter(item => item.prompt.trim())

  if (!targets?.length) return allTargets
  const requested = new Set(targets.map(target => target.ref_id))
  return allTargets.filter(target => requested.has(target.refId))
}

export function makeStoryboardAudioText(page: PictureBookStoryboardPage, language: 'zh' | 'en'): string {
  return [page.script.narration[language], page.script.dialogue[language]]
    .map(item => item?.trim())
    .filter(Boolean)
    .join('\n')
}

const route: FastifyPluginAsync = async (app) => {
  app.post<{ Body: { project_id: string; targets?: RequestedPageTarget[]; params?: Record<string, unknown> } }>(
    '/picture-book/generate-storyboard-images',
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

      const targets = selectStoryboardImageTargets(access.state, request.body.targets)
      if (!targets.length) return reply.status(400).send({ error: { code: 'NO_TARGETS', message: '没有可生成的分镜图片提示词' } })

      const batches: any[] = []
      const failures: Array<{ ref_id: string; message: string }> = []
      for (const target of targets) {
        try {
          const imageResponse = await (app.inject as any)({
            method: 'POST',
            url: '/generate/image',
            headers: request.headers.authorization ? { authorization: request.headers.authorization } : {},
            payload: {
              idempotency_key: `picture_book_${request.body.project_id}_${target.refId}_${Date.now()}`,
              model: PICTURE_BOOK_MODELS.image,
              prompt: target.prompt,
              quantity: 1,
              workspace_id: access.workspaceId,
              params: {
                ...makePictureBookImageParams(request.body.project_id, target.refId, access.style),
                ...(request.body.params ?? {}),
              },
            } as any,
          })
          const body = imageResponse.json() as any
          if (imageResponse.statusCode >= 400) throw new Error(body?.error?.message ?? `request failed: ${imageResponse.statusCode}`)
          await linkStoryboardBatch(request.body.project_id, access.workspaceId, access.teamId, request.user.id, target, body)
          batches.push({ ref_id: target.refId, batch_id: body.id, status: body.status })
        } catch (error) {
          failures.push({ ref_id: target.refId, message: error instanceof Error ? error.message : String(error) })
        }
      }

      return reply.send({ success: failures.length === 0, batches, failures })
    },
  )
}

async function linkStoryboardBatch(
  projectId: string,
  workspaceId: string,
  teamId: string,
  userId: string,
  target: StoryboardImageTarget,
  batch: any,
) {
  const estimatedCredits = Number(batch.estimated_credits ?? 0)
  await getDb().transaction().execute(async (trx) => {
    await trx.updateTable('task_batches').set({ picture_book_project_id: projectId }).where('id', '=', batch.id).execute()
    await trx
      .insertInto('picture_book_project_assets')
      .values({
        project_id: projectId,
        kind: 'page_image',
        ref_id: target.refId,
        name: `Page ${target.page}`,
        prompt: target.prompt,
        batch_id: batch.id,
        status: 'pending',
        metadata: JSON.stringify({ page: target.page, model: PICTURE_BOOK_MODELS.image }),
      })
      .onConflict((oc) =>
        oc.columns(['project_id', 'kind', 'ref_id']).doUpdateSet({
          prompt: target.prompt,
          batch_id: batch.id,
          status: 'pending',
          selected_asset_url: null,
          selected_asset_id: null,
          metadata: JSON.stringify({ page: target.page, model: PICTURE_BOOK_MODELS.image }) as any,
          updated_at: sql`now()`,
        }),
      )
      .execute()
    await trx
      .insertInto('picture_book_project_charges')
      .values({
        project_id: projectId,
        workspace_id: workspaceId,
        team_id: teamId,
        user_id: userId,
        charge_type: 'project',
        model: PICTURE_BOOK_MODELS.image,
        target_count: 1,
        estimated_credits: estimatedCredits,
        actual_credits: null,
        status: 'processing',
        batch_ids: [batch.id],
        metadata: JSON.stringify({ operation: 'page_image', ref_id: target.refId }),
      })
      .execute()
    await trx.updateTable('picture_book_projects').set({ estimated_credits: sql`estimated_credits + ${estimatedCredits}`, updated_at: sql`now()` }).where('id', '=', projectId).execute()
  })
}

export default route
