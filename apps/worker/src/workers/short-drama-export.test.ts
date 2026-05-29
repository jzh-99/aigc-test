import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildConcatManifest,
  validateShortDramaExportSegments,
} from './short-drama-export-utils.js'

test('validateShortDramaExportSegments rejects empty list', () => {
  assert.throws(() => validateShortDramaExportSegments([]), /至少需要 1 个片段视频/)
})

test('validateShortDramaExportSegments rejects missing video url', () => {
  assert.throws(() => validateShortDramaExportSegments([{ id: 's1', videoUrl: '' }]), /片段 s1 缺少视频地址/)
})

test('validateShortDramaExportSegments passes with valid segments', () => {
  assert.doesNotThrow(() => validateShortDramaExportSegments([
    { id: 's1', videoUrl: '/storage/video1.mp4' },
    { id: 's2', videoUrl: '/storage/video2.mp4' },
  ]))
})

test('buildConcatManifest escapes single quotes', () => {
  const manifest = buildConcatManifest(['C:/tmp/a.mp4', "C:/tmp/b'b.mp4"])
  assert.equal(manifest, "file 'C:/tmp/a.mp4'\nfile 'C:/tmp/b'\\''b.mp4'")
})

test('buildConcatManifest handles single path', () => {
  const manifest = buildConcatManifest(['/tmp/only.mp4'])
  assert.equal(manifest, "file '/tmp/only.mp4'")
})
