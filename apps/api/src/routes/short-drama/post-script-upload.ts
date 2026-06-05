import type { FastifyInstance } from 'fastify'
import {
  parseShortDramaDocxScriptBuffer,
  parseShortDramaTxtScriptBuffer,
} from './_script-source.js'

const SCRIPT_FILE_EXTS = ['txt', 'docx']
const MAX_SCRIPT_FILE_SIZE = 20 * 1024 * 1024

export default async function postScriptUpload(app: FastifyInstance): Promise<void> {
  app.post('/short-drama/script/upload', async (request, reply) => {
    const data = await (request as any).file({ limits: { fileSize: MAX_SCRIPT_FILE_SIZE } })
    if (!data) {
      return reply.status(400).send({
        error: { code: 'NO_FILE', message: '未提供文件' },
      })
    }

    const filename = data.filename as string
    const ext = filename.split('.').pop()?.toLowerCase() ?? ''
    if (!SCRIPT_FILE_EXTS.includes(ext)) {
      return reply.status(400).send({
        error: { code: 'INVALID_TYPE', message: '仅支持 txt/docx 格式' },
      })
    }

    const chunks: Buffer[] = []
    for await (const chunk of data.file) {
      chunks.push(chunk as Buffer)
    }
    const buffer = Buffer.concat(chunks)
    if (buffer.length > MAX_SCRIPT_FILE_SIZE) {
      return reply.status(400).send({
        error: { code: 'FILE_TOO_LARGE', message: '文件大小不能超过 20MB' },
      })
    }

    try {
      const text = ext === 'docx'
        ? await parseShortDramaDocxScriptBuffer(buffer)
        : parseShortDramaTxtScriptBuffer(buffer)

      return {
        text,
        charCount: text.length,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '文件解析失败'
      return reply.status(400).send({
        error: { code: 'PARSE_FAILED', message },
      })
    }
  })
}
