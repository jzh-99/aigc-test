import type { FastifyInstance } from 'fastify'
import postProjects from './short-drama/post-projects.js'
import getProjects from './short-drama/get-projects.js'
import getProjectId from './short-drama/get-project-id.js'
import putProjectId from './short-drama/put-project-id.js'
import deleteProjectId from './short-drama/delete-project-id.js'
import postScriptSummary from './short-drama/post-script-summary.js'
import postEpisodeOutlines from './short-drama/post-episode-outlines.js'
import postAssetPrompts from './short-drama/post-asset-prompts.js'
import postGenerateSegments from './short-drama/post-generate-segments.js'

export async function shortDramaRoutes(app: FastifyInstance) {
  // 项目 CRUD
  await app.register(postProjects)
  await app.register(getProjects)
  await app.register(getProjectId)
  await app.register(putProjectId)
  await app.register(deleteProjectId)

  // 文本生成
  await app.register(postScriptSummary)
  await app.register(postEpisodeOutlines)
  await app.register(postAssetPrompts)
  await app.register(postGenerateSegments)
}
