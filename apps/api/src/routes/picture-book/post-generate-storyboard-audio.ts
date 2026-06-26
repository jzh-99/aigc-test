import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'
import { type PictureBookStoryboardPage } from '@aigc/types'
import { sql } from 'kysely'
import { assertPictureBookProjectAccess, jsonbArray, PICTURE_BOOK_MODELS } from './_shared.js'
import { makeStoryboardAudioText } from './post-generate-storyboard-images.js'

type AudioLanguage = 'zh' | 'en'

interface AudioBody {
  project_id: string
  targets?: Array<{ ref_id: string; language?: AudioLanguage }>
  voice_zh_id?: string
  voice_en_id?: string
}

const route: FastifyPluginAsync = async (app) => {
  app.post<{ Body: AudioBody }>(
    '/picture-book/generate-storyboard-audio',
    {
      schema: {
        body: {
          type: 'object',
          required: ['project_id'],
          properties: {
            project_id: { type: 'string', format: 'uuid' },
            targets: { type: 'array', items: { type: 'object' } },
            voice_zh_id: { type: 'string', maxLength: 255 },
            voice_en_id: { type: 'string', maxLength: 255 },
          },
        },
      },
    },
    async (request, reply) => {
      const access = await assertPictureBookProjectAccess(request.body.project_id, request.user.id, true)
      if (!access) return reply.status(404).send({ error: { code: 'PROJECT_NOT_FOUND', message: '绘本项目不存在' } })

      const voiceZhId = request.body.voice_zh_id ?? access.state.settings.voiceZhId
      const voiceEnId = request.body.voice_en_id ?? access.state.settings.voiceEnId
      const targets = selectAudioTargets(access.state.storyboard, request.body.targets)
      if (!targets.length) return reply.status(400).send({ error: { code: 'NO_TARGETS', message: '没有可生成的语音脚本' } })

      const nextState = { ...access.state, storyboard: [...access.state.storyboard] }
      const outputs: any[] = []
      const failures: Array<{ ref_id: string; language: AudioLanguage; message: string }> = []

      for (const target of targets) {
        const voiceId = target.language === 'zh' ? voiceZhId : voiceEnId
        if (!voiceId) {
          failures.push({ ref_id: target.refId, language: target.language, message: `${target.language} voice_id required` })
          continue
        }

        let text: string
        try {
          text = makeStoryboardAudioText(target.page, target.language)
        } catch {
          failures.push({ ref_id: target.refId, language: target.language, message: 'audio text parse error' })
          continue
        }
        if (!text) {
          failures.push({ ref_id: target.refId, language: target.language, message: 'audio text empty' })
          continue
        }

        try {
          const response = await (app.inject as any)({
            method: 'POST',
            url: '/api/v1/tts/generate',
            headers: request.headers.authorization ? { authorization: request.headers.authorization } : {},
            payload: {
              idempotency_key: `picture_book_${request.body.project_id}_${target.refId}_${target.language}_${Date.now()}`,
              workspace_id: access.workspaceId,
              model: PICTURE_BOOK_MODELS.tts,
              text,
              voice_id: voiceId,
            } as any,
          })
          const body = response.json() as any
          if (response.statusCode >= 400) throw new Error(body?.error?.message ?? `request failed: ${response.statusCode}`)

          const outputUrl = body.output_url ?? null
          const pageIndex = nextState.storyboard.findIndex(page => page.page === target.page.page)
          if (pageIndex >= 0) {
            nextState.storyboard[pageIndex] = {
              ...nextState.storyboard[pageIndex],
              voice: {
                ...nextState.storyboard[pageIndex].voice,
                [target.language]: outputUrl,
              },
            }
          }

          await recordAudioAsset({
            projectId: request.body.project_id,
            workspaceId: access.workspaceId,
            teamId: access.teamId,
            userId: request.user.id,
            target,
            batch: body,
            outputUrl,
          })
          outputs.push({ ref_id: target.refId, language: target.language, batch_id: body.id, output_url: outputUrl })
        } catch (error) {
          // 单条分镜音频生成失败：记录错误日志，并入队 failures 让前端展示部分失败结果，不中断整批
          request.log.error({ err: error, refId: target.refId, language: target.language }, '绘本分镜音频生成失败')
          failures.push({ ref_id: target.refId, language: target.language, message: error instanceof Error ? error.message : String(error) })
        }
      }

      nextState.draft = { dirty: false, savedAt: new Date().toISOString() }
      await getDb()
        .updateTable('picture_book_projects')
        .set({ state: JSON.stringify(nextState) as any, draft_saved_at: sql`now()`, updated_at: sql`now()` })
        .where('id', '=', request.body.project_id)
        .execute()

      return reply.send({ success: failures.length === 0, outputs, failures, state: nextState })
    },
  )
}

function selectAudioTargets(
  pages: PictureBookStoryboardPage[],
  targets?: Array<{ ref_id: string; language?: AudioLanguage }>,
): Array<{ refId: string; language: AudioLanguage; page: PictureBookStoryboardPage }> {
  const allTargets = pages.flatMap(page => [
    { refId: `page_${page.page}`, language: 'zh' as const, page },
    { refId: `page_${page.page}`, language: 'en' as const, page },
  ])
  if (!targets?.length) return allTargets
  const requested = new Set(targets.flatMap(target => target.language ? [`${target.ref_id}:${target.language}`] : [`${target.ref_id}:zh`, `${target.ref_id}:en`]))
  return allTargets.filter(target => requested.has(`${target.refId}:${target.language}`))
}

async function recordAudioAsset(input: {
  projectId: string
  workspaceId: string
  teamId: string
  userId: string
  target: { refId: string; language: AudioLanguage; page: PictureBookStoryboardPage }
  batch: any
  outputUrl: string | null
}) {
  const estimatedCredits = Number(input.batch.estimated_credits ?? 0)
  const actualCredits = Number(input.batch.actual_credits ?? estimatedCredits)
  const kind = input.target.language === 'zh' ? 'page_audio_zh' : 'page_audio_en'
  await getDb().transaction().execute(async (trx) => {
    await trx.updateTable('task_batches').set({ picture_book_project_id: input.projectId, source: 'studio' }).where('id', '=', input.batch.id).execute()
    await trx
      .insertInto('picture_book_project_assets')
      .values({
        project_id: input.projectId,
        kind,
        ref_id: input.target.refId,
        name: `Page ${input.target.page.page} ${input.target.language.toUpperCase()} Audio`,
        prompt: makeStoryboardAudioText(input.target.page, input.target.language),
        selected_asset_url: input.outputUrl,
        batch_id: input.batch.id,
        status: 'completed',
        metadata: JSON.stringify({ page: input.target.page.page, language: input.target.language, model: PICTURE_BOOK_MODELS.tts }),
      })
      .onConflict((oc) =>
        oc.columns(['project_id', 'kind', 'ref_id']).doUpdateSet({
          prompt: makeStoryboardAudioText(input.target.page, input.target.language),
          selected_asset_url: input.outputUrl,
          batch_id: input.batch.id,
          status: 'completed',
          metadata: JSON.stringify({ page: input.target.page.page, language: input.target.language, model: PICTURE_BOOK_MODELS.tts }) as any,
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
        model: PICTURE_BOOK_MODELS.tts,
        target_count: 1,
        estimated_credits: estimatedCredits,
        actual_credits: actualCredits,
        status: 'completed',
        batch_ids: jsonbArray([input.batch.id]),
        metadata: JSON.stringify({ operation: kind, ref_id: input.target.refId }),
      })
      .execute()
    await trx
      .updateTable('picture_book_projects')
      .set({
        estimated_credits: sql`estimated_credits + ${estimatedCredits}`,
        actual_credits: sql`actual_credits + ${actualCredits}`,
        updated_at: sql`now()`,
      })
      .where('id', '=', input.projectId)
      .execute()
  })
}

export default route
