// 测试专用：在 import @aigc/db 之前加载 .env 到 process.env。
//
// 背景：apps/api/src 下既有测试都是纯函数、不连真实库，故无需 env；本任务
// provisionCaller 是首个连真实库的测试，需 DATABASE_URL。ESM 模块按源码 import
// 顺序实例化，故把 `import './test-env.js'` 放在测试文件第一行，可确保在
// `import { provisionCaller }`（间接 import @aigc/db）之前完成 env 加载。
//
// 生产路径不走此文件，env 由 src/index.ts 的 dotenv config() 加载。

import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from 'dotenv'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// worktree 根目录的 .env（对齐 src/index.ts 的路径解析）
config({ path: path.resolve(__dirname, '../../../../.env') })
