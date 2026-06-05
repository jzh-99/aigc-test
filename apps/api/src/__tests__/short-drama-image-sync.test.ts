import { strict as assert } from 'node:assert'
import { makeDefaultShortDramaState } from '@aigc/types'
import type { ShortDramaState, ShortDramaAsset } from '@aigc/types'
import {
  applyShortDramaImageBatchSync,
  type ShortDramaImageTaskRow,
} from '../routes/short-drama/_shared.js'

console.log('测试短剧素材图片 batch 同步...')

function makeAsset(overrides: Partial<ShortDramaAsset>): ShortDramaAsset {
  return {
    id: overrides.id ?? 'asset-x',
    kind: overrides.kind ?? 'character',
    scope: 'global',
    name: overrides.name ?? 'X',
    description: '',
    imageUrl: overrides.imageUrl ?? null,
    referenceImageUrl: null,
    episodeNumber: null,
    status: overrides.status ?? 'pending',
    createdAt: '2026-06-04T00:00:00.000Z',
    updatedAt: '2026-06-04T00:00:00.000Z',
    ...overrides,
  }
}

function makeStateWithAssets(items: ShortDramaAsset[]): ShortDramaState {
  const state = makeDefaultShortDramaState({
    prompt: '测试',
    style: '真人都市',
    aspectRatio: '9:16',
    episodeCount: 1,
  })
  state.assets.items = items
  state.assets.status = 'generating'
  return state
}

// 场景 1：task completed 但 storage_url 还为空（transfer 队列未搬完）
// 不应回写 imageUrl 也不应把 asset 标为 completed
{
  const state = makeStateWithAssets([
    makeAsset({ id: 'a-char', kind: 'character' }),
  ])
  const tasks: ShortDramaImageTaskRow[] = [
    { taskId: 't1', versionIndex: 0, status: 'completed', storageUrl: null },
  ]
  const assetIdMap = [{ versionIndex: 0, assetId: 'a-char' }]

  const changed = applyShortDramaImageBatchSync(state, assetIdMap, tasks)
  assert.equal(state.assets.items[0].imageUrl, null, 'storage_url 为空时不应回写 imageUrl')
  assert.notEqual(state.assets.items[0].status, 'completed', 'storage_url 为空时不应将 asset 标为 completed')
  assert.notEqual(state.assets.status, 'completed', 'storage_url 为空时不应将 state.assets.status 标为 completed')
  // 仍应反映"生成中"或保持原状，至少不应为 completed
  void changed
  console.log('✓ task completed 但 storage_url 为空时不视为 ready')
}

// 场景 2：task completed 且 storage_url 非空 → 正常完成
{
  const state = makeStateWithAssets([
    makeAsset({ id: 'a-char', kind: 'character' }),
    makeAsset({ id: 'a-scene', kind: 'scene' }),
    makeAsset({ id: 'a-req', kind: 'requisite' }),
  ])
  const tasks: ShortDramaImageTaskRow[] = [
    { taskId: 't1', versionIndex: 0, status: 'completed', storageUrl: 'https://tos.example/char.jpg' },
    { taskId: 't2', versionIndex: 1, status: 'completed', storageUrl: 'https://tos.example/scene.jpg' },
    { taskId: 't3', versionIndex: 2, status: 'completed', storageUrl: 'https://tos.example/req.jpg' },
  ]
  const assetIdMap = [
    { versionIndex: 0, assetId: 'a-char' },
    { versionIndex: 1, assetId: 'a-scene' },
    { versionIndex: 2, assetId: 'a-req' },
  ]

  const changed = applyShortDramaImageBatchSync(state, assetIdMap, tasks)
  assert.equal(changed, true)
  assert.equal(state.assets.items[0].imageUrl, 'https://tos.example/char.jpg')
  assert.equal(state.assets.items[0].status, 'completed')
  assert.equal(state.assets.items[2].imageUrl, 'https://tos.example/req.jpg')
  assert.equal(state.assets.items[2].status, 'completed')
  assert.equal(state.assets.status, 'completed', '三类素材全完成时 state.assets.status 应为 completed')
  console.log('✓ task completed 且 storage_url 非空时正常回写并整体 completed')
}

// 场景 3：requisite 还未完成时不应整体 completed（修复 requisite 漏判）
{
  const state = makeStateWithAssets([
    makeAsset({ id: 'a-char', kind: 'character' }),
    makeAsset({ id: 'a-scene', kind: 'scene' }),
    makeAsset({ id: 'a-req', kind: 'requisite' }),
  ])
  const tasks: ShortDramaImageTaskRow[] = [
    { taskId: 't1', versionIndex: 0, status: 'completed', storageUrl: 'https://tos.example/char.jpg' },
    { taskId: 't2', versionIndex: 1, status: 'completed', storageUrl: 'https://tos.example/scene.jpg' },
    // a-req 没有任务结果
  ]
  const assetIdMap = [
    { versionIndex: 0, assetId: 'a-char' },
    { versionIndex: 1, assetId: 'a-scene' },
  ]

  applyShortDramaImageBatchSync(state, assetIdMap, tasks)
  assert.notEqual(state.assets.status, 'completed', '存在未完成的 requisite 时整体不应 completed')
  console.log('✓ 存在未完成的 requisite 时整体不视为 completed')
}

// 场景 4：task failed → asset 标 failed
{
  const state = makeStateWithAssets([
    makeAsset({ id: 'a-char', kind: 'character' }),
  ])
  const tasks: ShortDramaImageTaskRow[] = [
    { taskId: 't1', versionIndex: 0, status: 'failed', storageUrl: null },
  ]
  const assetIdMap = [{ versionIndex: 0, assetId: 'a-char' }]

  applyShortDramaImageBatchSync(state, assetIdMap, tasks)
  assert.equal(state.assets.items[0].status, 'failed')
  assert.equal(state.assets.status, 'failed')
  console.log('✓ task failed 时 asset 标 failed，整体 failed')
}

// 场景 5：task processing → asset 标 generating
{
  const state = makeStateWithAssets([
    makeAsset({ id: 'a-char', kind: 'character' }),
  ])
  const tasks: ShortDramaImageTaskRow[] = [
    { taskId: 't1', versionIndex: 0, status: 'processing', storageUrl: null },
  ]
  const assetIdMap = [{ versionIndex: 0, assetId: 'a-char' }]

  applyShortDramaImageBatchSync(state, assetIdMap, tasks)
  assert.equal(state.assets.items[0].status, 'generating')
  assert.equal(state.assets.status, 'generating')
  console.log('✓ task processing 时 asset 标 generating')
}

console.log('全部测试通过 ✓')
