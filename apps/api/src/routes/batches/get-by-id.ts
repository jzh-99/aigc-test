import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'
import { signAssetUrl } from '../../lib/storage.js'

const route: FastifyPluginAsync = async (app) => {
  // GET /batches/:id — batch detail with tasks + assets
  app.get<{ Params: { id: string } }>('/batches/:id', async (request, reply) => {
    const { id } = request.params
    const db = getDb()

    const batch = await db
      .selectFrom('task_batches')
      .selectAll()
      .where('id', '=', id)
      .where('is_deleted', '=', false)
      .executeTakeFirst()

    if (!batch) {
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: '生成记录未找到' },
      })
    }

    // Authorization: user must own the batch, be a workspace member, or be admin
    if (batch.user_id !== request.user.id && request.user.role !== 'admin') {
      if (batch.workspace_id) {
        const wsMember = await db
          .selectFrom('workspace_members')
          .select('role')
          .where('workspace_id', '=', batch.workspace_id)
          .where('user_id', '=', request.user.id)
          .executeTakeFirst()
        if (!wsMember) {
          return reply.status(403).send({
            success: false,
            error: { code: 'FORBIDDEN', message: 'Not authorized to view this batch' },
          })
        }
      } else {
        return reply.status(403).send({
          success: false,
          error: { code: 'FORBIDDEN', message: 'Not authorized to view this batch' },
        })
      }
    }

    const tasks = await db
      .selectFrom('tasks')
      .selectAll()
      .where('batch_id', '=', id)
      .orderBy('version_index', 'asc')
      .execute()

    const assets = await db
      .selectFrom('assets')
      .selectAll()
      .where('batch_id', '=', id)
      .where('is_deleted', '=', false)
      .execute()

    const assetByTask: Map<string, any> = new Map(assets.map((a: any) => [a.task_id, a]))

    // Sign asset URLs
    for (const asset of assets) {
      if ((asset as any).storage_url) {
        (asset as any).storage_url = await signAssetUrl((asset as any).storage_url)
      }
    }

    // Fetch batch creator info
    const creator = await db
      .selectFrom('users')
      .select(['id', 'username', 'avatar_url'])
      .where('id', '=', batch.user_id)
      .executeTakeFirst()

    const queuePosition = batch.status === 'pending'
      ? Number(((await db
          .selectFrom('task_batches')
          .select((eb: any) => eb.fn.countAll().as('count'))
          .where('is_deleted', '=', false)
          .where('status', '=', 'pending')
          .where('provider', '=', batch.provider)
          .where('created_at', '<', batch.created_at)
          .executeTakeFirst()) as { count: string | number } | undefined)?.count ?? 0)
      : null

    return reply.send({
      id: batch.id,
      module: batch.module,
      provider: batch.provider,
      model: batch.model,
      prompt: batch.prompt,
      params: batch.params,
      quantity: batch.quantity,
      completed_count: batch.completed_count,
      failed_count: batch.failed_count,
      status: batch.status,
      estimated_credits: batch.estimated_credits,
      actual_credits: batch.actual_credits,
      created_at: batch.created_at.toISOString?.() ?? String(batch.created_at),
      queue_position: queuePosition,
      user: creator ? { id: creator.id, username: creator.username, avatar_url: creator.avatar_url ?? null } : undefined,
      tasks: await Promise.all(tasks.map(async (t: any) => {
        const asset = assetByTask.get(t.id)
        return {
          id: t.id,
          version_index: t.version_index,
          status: t.status,
          estimated_credits: t.estimated_credits,
          credits_cost: t.credits_cost,
          error_message: t.error_message,
          processing_started_at: t.processing_started_at?.toISOString?.() ?? t.processing_started_at ?? null,
          completed_at: t.completed_at?.toISOString?.() ?? t.completed_at ?? null,
          asset: asset
            ? {
                id: asset.id,
                type: asset.type,
                original_url: await signAssetUrl(asset.original_url),
                storage_url: await signAssetUrl(asset.storage_url),
                raw_storage_url: asset.storage_url ?? asset.original_url ?? null,
                transfer_status: asset.transfer_status,
                file_size: asset.file_size,
                width: asset.width,
                height: asset.height,
              }
            : null,
        }
      })),
    })
  })
}

export default route
