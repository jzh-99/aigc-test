import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from 'dotenv'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
config({ path: path.resolve(__dirname, '../../../.env') })
config({ path: path.resolve(__dirname, '../../../prompts.env'), override: false })

import { buildApp } from './app.js'

async function main() {
  const app = await buildApp()

  const host = process.env.API_HOST ?? '0.0.0.0'
  const port = parseInt(process.env.API_PORT ?? '3001', 10)

  const shutdown = async (signal: string) => {
    app.log.info(`收到 ${signal}，开始优雅关闭...`)
    await app.close() // 触发 onClose 钩子，关闭 Redis 连接
    process.exit(0)
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))

  await app.listen({ host, port })
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
