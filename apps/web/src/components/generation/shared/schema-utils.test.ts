import assert from 'node:assert/strict'
import test from 'node:test'
import { hasVideoAudioControl, hasVideoDurationControl } from './schema-utils'
import type { ModelItem } from '@aigc/types'

function makeModel(code: string, paramsSchema: unknown): ModelItem {
  return {
    id: code,
    code,
    name: code,
    description: null,
    module: 'video',
    category_references: {},
    params_pricing: [],
    params_schema: paramsSchema,
    resolution: null,
    is_active: true,
    provider_code: 'test',
    avatar: null,
  }
}

test('视频时长和音频能力由后端 params_schema 决定', () => {
  const ctyunSeedance = makeModel('ctyun-seedance-2.0', {
    time_length: [{ label: '5秒', value: 5 }],
    video_voice: [{ label: '有声', value: true }],
  })
  const arbitraryModel = makeModel('anything', {})

  assert.equal(hasVideoDurationControl(ctyunSeedance), true)
  assert.equal(hasVideoAudioControl(ctyunSeedance), true)
  assert.equal(hasVideoDurationControl(arbitraryModel), false)
  assert.equal(hasVideoAudioControl(arbitraryModel), false)
})
