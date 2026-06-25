// 创建开放接口调用方（API Key）—— CLI
// 用法：tsx apps/api/src/cli/create-open-api-key.ts <name>
// 对齐源项目 app/cli/create_api_key.py：
//   - 明文 key 仅打印一次（库内只存 sha256 摘要）
//   - name 作为调用方名称与归属容器标识，需全局唯一
//
// 本 CLI 会在单个事务内联动创建 system_user + team + workspace + credit_account +
// team_members + api_clients（详见 provisionCaller）。

import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from 'dotenv'

// CLI 不走 src/index.ts，需自行加载 .env（ESM 按顺序执行，先于下方 @aigc/db import）
const __dirname = path.dirname(fileURLToPath(import.meta.url))
config({ path: path.resolve(__dirname, '../../../../.env') })

import { provisionCaller } from '../lib/provision-caller.js'
import { closeDb } from '@aigc/db'

async function main(): Promise<void> {
  const name = process.argv[2]
  if (!name) {
    console.error('用法: pnpm openapi:key -- <name>')
    console.error('示例: pnpm openapi:key -- c端联调')
    process.exit(1)
  }

  const { apiKey, clientId } = await provisionCaller(name)

  // 明文 key 仅显示一次（对齐源 create_api_key.py：只 print(api_key)）
  console.log(`API Key（仅显示一次，请妥善保存）: ${apiKey}`)
  console.log(`Client ID: ${clientId}`)
  console.log(`归属容器: openapi:${name}`)
  console.log('')
  console.log('Swagger Authorize 的 Value 填：')
  console.log(apiKey)
  console.log('')
  console.log('HTTP Header 写法：')
  console.log(`Authorization: Bearer ${apiKey}`)
  console.log('')
  console.log('本地 ping 验证：')
  console.log(`curl -X GET "http://localhost:7001/api/v3/ping" -H "Authorization: Bearer ${apiKey}"`)
}

main()
  .catch((err) => {
    console.error('创建失败：', err instanceof Error ? err.message : err)
    process.exit(1)
  })
  .finally(async () => {
    // 关闭连接池，让进程能正常退出
    await closeDb()
  })
