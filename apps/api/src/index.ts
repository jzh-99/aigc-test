import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from 'dotenv'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
config({ path: path.resolve(__dirname, '../../../.env') })
config({ path: path.resolve(__dirname, '../../../prompts.env'), override: false })

import { buildApp } from './app.js'
import { loadNacosConfig } from '@aigc/nacos-config'

async function main() {
  // 在 buildApp 之前加载 Nacos 远程配置：远程值覆盖本地 .env，让 AI 相关参数
  // （key/endpoint/model 等）支持热更。Nacos 不可用时阻断启动，避免混用本地旧值。
  // 详见 packages/nacos-config。时序：dotenv(L6-7) → Nacos 覆盖 → buildApp。
  await loadNacosConfig()

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
