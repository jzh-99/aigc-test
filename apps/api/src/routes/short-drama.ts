import type { FastifyInstance } from 'fastify'
import postProjects from './short-drama/post-projects.js'
import getProjects from './short-drama/get-projects.js'
import getProjectId from './short-drama/get-project-id.js'
import putProjectId from './short-drama/put-project-id.js'
import deleteProjectId from './short-drama/delete-project-id.js'

export async function shortDramaRoutes(app: FastifyInstance) {
  await app.register(postProjects)
  await app.register(getProjects)
  await app.register(getProjectId)
  await app.register(putProjectId)
  await app.register(deleteProjectId)
}
