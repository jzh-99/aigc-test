import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'
import { sql } from 'kysely'
import { assertProjectAccess } from './_shared.js'

// POST /video-studio/projects/:id/series/episodes — 批量创建系列剧集
const route: FastifyPluginAsync = async (app) => {
  app.post<{
    Params: { id: string }
    Body: {
      workspace_id: string
      name: string
      describeData: { description: string; style: string; duration: number; aspectRatio: string }
      outline: {
        title: string
        synopsis: string
        worldbuilding?: string
        mainCharacters?: Array<{ name: string; description: string; voiceDescription?: string }>
        mainScenes?: Array<{ name: string; description: string }>
        relationships?: Array<{ from: string; to: string; description: string }>
        episodes: Array<{ id: string; title: string; synopsis: string; coreConflict?: string; hook?: string }>
      }
      characterImages: Record<string, string>
      sceneImages: Record<string, string>
      assetStyle?: string
    }
  }>('/video-studio/projects/:id/series/episodes', async (request, reply) => {
    const db = getDb()
    const userId = request.user.id
    const { id } = request.params
    const { workspace_id, name, describeData, outline, characterImages, sceneImages, assetStyle } = request.body

    const member = await db
      .selectFrom('workspace_members')
      .select('workspace_id')
      .where('workspace_id', '=', workspace_id)
      .where('user_id', '=', userId)
      .executeTakeFirst()
    if (!member) return reply.status(403).send({ error: 'forbidden' })
    if (!outline?.episodes?.length) return reply.status(400).send({ error: 'episodes required' })

    // 构建系列父项目的 wizard_state
    const parentState = {
      statuses: { describe: 'completed', outline: 'completed', script: 'locked', storyboard: 'locked', characters: 'completed', video: 'locked', complete: 'pending' },
      activeStep: 'complete',
      projectType: 'series',
      seriesOutline: outline,
      activeEpisodeId: null,
      episodes: [],
      describeData,
      draftDescribeData: describeData,
      assetStyle: assetStyle ?? describeData.style,
      scriptData: null,
      scriptHistory: [],
      shots: [],
      fragments: [],
      shotImages: {},
      characterImages,
      sceneImages,
      characterImageHistory: {},
      sceneImageHistory: {},
      shotVideos: {},
      pendingImageBatches: {},
      pendingVideoBatches: {},
    }

    const episodes = await db.transaction().execute(async (trx) => {
      // upsert 系列父项目
      await trx
        .insertInto('video_studio_projects')
        .values({
          id,
          workspace_id,
          user_id: userId,
          name: outline.title || name,
          wizard_state: JSON.stringify(parentState),
          project_type: 'series',
          series_parent_id: null,
          episode_index: null,
        })
        .onConflict((oc) => oc.column('id').doUpdateSet({
          name: outline.title || name,
          wizard_state: JSON.stringify(parentState) as any,
          project_type: 'series',
          series_parent_id: null,
          episode_index: null,
          updated_at: sql`now()`,
        }))
        .execute()

      // 软删除旧剧集
      await trx
        .updateTable('video_studio_projects')
        .set({ is_deleted: true, deleted_at: sql`now()`, updated_at: sql`now()` })
        .where('series_parent_id', '=', id)
        .where('is_deleted', '=', false)
        .execute()

      const rows = [] as Array<{ id: string; name: string; episode_index: number; wizard_state: unknown }>
      for (const [index, episode] of outline.episodes.entries()) {
        const episodeId = crypto.randomUUID()
        // 每集描述只包含本集故事，不含完整世界观/角色列表
        const episodeDescription = [
          `本集标题：${episode.title}`,
          `本集梗概：${episode.synopsis}`,
          episode.coreConflict ? `本集核心冲突：${episode.coreConflict}` : '',
          episode.hook ? `本集结尾钩子：${episode.hook}` : '',
        ].filter(Boolean).join('\n')
        const episodeDescribeData = { ...describeData, description: episodeDescription }
        const wizardState = {
          statuses: { describe: 'completed', outline: 'locked', script: 'pending', storyboard: 'locked', characters: 'locked', video: 'locked', complete: 'locked' },
          activeStep: 'script',
          projectType: 'single',
          seriesParentId: id,
          episodeIndex: index + 1,
          sharedCharacters: outline.mainCharacters ?? [],
          sharedScenes: outline.mainScenes ?? [],
          sharedCharacterImages: characterImages,
          sharedSceneImages: sceneImages,
          seriesOutline: null,
          activeEpisodeId: null,
          episodes: [],
          describeData: episodeDescribeData,
          draftDescribeData: episodeDescribeData,
          assetStyle: assetStyle ?? describeData.style,
          scriptData: null,
          scriptHistory: [],
          shots: [],
          fragments: [],
          shotImages: {},
          characterImages: {},
          sceneImages: {},
          characterImageHistory: {},
          sceneImageHistory: {},
          shotVideos: {},
          pendingImageBatches: {},
          pendingVideoBatches: {},
        }
        const episodeName = `第 ${index + 1} 集：${episode.title}`
        await trx
          .insertInto('video_studio_projects')
          .values({
            id: episodeId,
            workspace_id,
            user_id: userId,
            name: episodeName,
            wizard_state: JSON.stringify(wizardState),
            project_type: 'episode',
            series_parent_id: id,
            episode_index: index + 1,
          })
          .execute()
        rows.push({ id: episodeId, name: episodeName, episode_index: index + 1, wizard_state: wizardState })
      }
      return rows
    })

    return reply.send({ success: true, episodes })
  })
}

export default route
