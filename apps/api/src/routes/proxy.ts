import type { FastifyInstance } from 'fastify'

// Only proxy URLs from allowed storage hosts to prevent SSRF
function isAllowedUrl(url: string): boolean {
  const storageUrl = process.env.EXTERNAL_STORAGE_URL ?? ''
  if (!storageUrl) return false
  try {
    const allowed = new URL(storageUrl)
    const target = new URL(url)
    return target.hostname === allowed.hostname && target.port === allowed.port
  } catch {
    return false
  }
}

export async function proxyRoutes(app: FastifyInstance) {
  // GET /api/v1/assets/proxy?url=<encoded_storage_url>
  // Streams a storage resource over HTTPS, hiding the internal HTTP address from clients.
  app.get<{ Querystring: { url: string } }>(
    '/assets/proxy',
    { schema: { querystring: { type: 'object', required: ['url'], properties: { url: { type: 'string' } } } } },
    async (request, reply) => {
      const { url } = request.query

      if (!isAllowedUrl(url)) {
        return reply.code(403).send({ error: 'Forbidden' })
      }

      let upstream: Response
      try {
        upstream = await fetch(url)
      } catch {
        return reply.code(502).send({ error: 'Failed to fetch asset' })
      }

      if (!upstream.ok) {
        return reply.code(upstream.status).send({ error: 'Upstream error' })
      }

      const contentType = upstream.headers.get('content-type') ?? 'application/octet-stream'
      const contentLength = upstream.headers.get('content-length')

      reply.header('Content-Type', contentType)
      reply.header('Cache-Control', 'public, max-age=31536000, immutable')
      if (contentLength) reply.header('Content-Length', contentLength)

      return reply.send(upstream.body)
    },
  )
}
