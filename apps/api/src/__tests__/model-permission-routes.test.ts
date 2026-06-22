import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const __dirname = dirname(fileURLToPath(import.meta.url))

test('视频生成路由检查团队级模型禁用配置', async () => {
  const source = await readFile(join(__dirname, '../routes/videos/post-generate.ts'), 'utf-8')

  assert.match(source, /team_model_configs/)
  assert.match(source, /MODEL_DISABLED/)
  assert.match(source, /where\('team_id', '=', teamId\)/)
  assert.match(source, /where\('model_id', '=', providerModel\.modelId\)/)
})

test('短剧片段视频生成路由检查团队级模型禁用配置', async () => {
  const source = await readFile(join(__dirname, '../routes/short-drama/post-generate-segment-video.ts'), 'utf-8')

  assert.match(source, /team_model_configs/)
  assert.match(source, /MODEL_DISABLED/)
  assert.match(source, /where\('team_id', '=', teamId\)/)
  assert.match(source, /where\('model_id', '=', modelRecord\.modelId\)/)
})
