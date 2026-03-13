import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from 'dotenv'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
config({ path: path.resolve(__dirname, '../../../.env') })

import { buildApp } from './app.js'

async function main() {
  const app = await buildApp()

  const host = process.env.API_HOST ?? '0.0.0.0'
  const port = parseInt(process.env.API_PORT ?? '3001', 10)

  await app.listen({ host, port })
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
