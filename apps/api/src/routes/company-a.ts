import type { FastifyInstance } from 'fastify'
import { encryptProxyUrl } from '../lib/storage.js'

const COMPANY_A_API = 'http://222.191.78.28:17373/zxin/picture'
const IMAGE_HOST_FROM = 'http://imagecache.itv.jsinfo.net:8080'

function toProxyUrl(originalUrl: string): string {
  // Rewrite image host to the accessible mirror, then encrypt for /assets/proxy
  const imageBase = process.env.COMPANY_A_IMAGE_BASE ?? 'http://61.155.227.69:8899'
  const rewritten = originalUrl.replace(IMAGE_HOST_FROM, imageBase)
  return `/api/v1/assets/proxy?token=${encryptProxyUrl(rewritten)}`
}

export async function companyARoutes(app: FastifyInstance) {
  app.get<{ Querystring: { programname?: string; contentcode?: string; programtype?: string } }>(
    '/company-a/pictures',
    {
      schema: {
        querystring: {
          type: 'object',
          properties: {
            programname: { type: 'string' },
            contentcode: { type: 'string' },
            programtype: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      const { programname, contentcode, programtype } = request.query

      const params = new URLSearchParams()
      if (programname) params.set('programname', programname)
      if (contentcode) params.set('contentcode', contentcode)
      if (programtype) params.set('programtype', programtype)

      const url = params.toString() ? `${COMPANY_A_API}?${params}` : COMPANY_A_API

      let upstream: Response
      try {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), 10_000)
        try {
          upstream = await fetch(url, { signal: controller.signal })
        } finally {
          clearTimeout(timer)
        }
      } catch (err: any) {
        if (err?.name === 'AbortError') {
          return reply.code(504).send({ error: 'Gateway timeout' })
        }
        return reply.code(502).send({ error: 'Failed to reach company-a API' })
      }

      if (!upstream.ok) {
        return reply.code(upstream.status).send({ error: 'Upstream error' })
      }

      const json = await upstream.json() as {
        data: Array<{
          contentcode: string
          programname: string
          programtype: number
          posters: Array<{ name: string; url: string }>
        }>
      }

      const data = (json.data ?? [])
        .map((item) => ({
          ...item,
          posters: item.posters.map((p) => ({ ...p, url: toProxyUrl(p.url) })),
        }))
        .filter((item) => item.posters.length > 0)

      return reply.send({ data })
    },
  )
}
