import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from 'dotenv'
import { setDefaultResultOrder } from 'node:dns'

// 优先 IPv4，避免 IPv6 不通导致 fetch 超时
setDefaultResultOrder('ipv4first')

const __dirname = path.dirname(fileURLToPath(import.meta.url))
config({ path: path.resolve(__dirname, '../../../.env') })
config({ path: path.resolve(__dirname, '../../../prompts.env'), override: false })
