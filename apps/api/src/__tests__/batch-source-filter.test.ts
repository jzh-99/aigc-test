import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

import route from '../routes/batches/source-filter.js'
import { normalizeBatchSource, resolveBatchSource } from '../lib/batch-source.js'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

describe('batch source helper', () => {
  test('routes/batches/source-filter default export is a Fastify plugin', () => {
    assert.equal(typeof route, 'function')
  })

  test('normalizeBatchSource - 默认值处理', () => {
    assert.equal(normalizeBatchSource(undefined), 'generation')
    assert.equal(normalizeBatchSource(null), 'generation')
    assert.equal(normalizeBatchSource(''), 'generation')
  })

  test('normalizeBatchSource - 合法值', () => {
    assert.equal(normalizeBatchSource('generation'), 'generation')
    assert.equal(normalizeBatchSource('studio'), 'studio')
    assert.equal(normalizeBatchSource('canvas'), 'canvas')
  })

  test('normalizeBatchSource - 非法值抛出错误', () => {
    assert.throws(() => normalizeBatchSource('invalid'), /Invalid batch source/)
    assert.throws(() => normalizeBatchSource('music'), /Invalid batch source/)
    assert.throws(() => normalizeBatchSource('GENERATION'), /Invalid batch source/)
  })

  test('resolveBatchSource - 项目关联优先归类到 studio/canvas', () => {
    assert.equal(resolveBatchSource({ module: 'image' }), 'generation')
    assert.equal(resolveBatchSource({ module: 'image', videoStudioProjectId: 'project-1' }), 'studio')
    assert.equal(resolveBatchSource({ module: 'image', pictureBookProjectId: 'project-1' }), 'studio')
    assert.equal(resolveBatchSource({ module: 'video', shortDramaProjectId: 'project-1' }), 'studio')
    assert.equal(resolveBatchSource({ module: 'image', canvasId: 'canvas-1' }), 'canvas')
  })

  test('resolveBatchSource - 业务模块默认来源', () => {
    assert.equal(resolveBatchSource({ module: 'music' }), 'studio')
    assert.equal(resolveBatchSource({ module: 'music_voice_clone' }), 'studio')
    assert.equal(resolveBatchSource({ module: 'picture_book' }), 'studio')
    assert.equal(resolveBatchSource({ module: 'short_drama' }), 'studio')
    assert.equal(resolveBatchSource({ module: 'storyboard' }), 'canvas')
  })

  test('batches list - generation 来源排除项目关联历史数据', async () => {
    const content = await readFile(join(__dirname, '../routes/batches/get-list.ts'), 'utf-8')

    assert.ok(content.includes("if (source === 'generation')"))
    assert.ok(content.includes(".where('canvas_id', 'is', null)"))
    assert.ok(content.includes(".where('video_studio_project_id', 'is', null)"))
    assert.ok(content.includes(".where('picture_book_project_id', 'is', null)"))
    assert.ok(content.includes(".where('short_drama_project_id', 'is', null)"))
  })
})
