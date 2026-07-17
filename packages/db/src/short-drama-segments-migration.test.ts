import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const migrationPath = resolve(process.cwd(), 'migrations/057_short_drama_segments.ts')
const content = readFileSync(migrationPath, 'utf8')

console.log('测试短剧片段结构化迁移...')

assert.ok(content.includes("createTable('short_drama_segments')"))
assert.ok(content.includes("project_id"))
assert.ok(content.includes("episode_number"))
assert.ok(content.includes("segment_id"))
assert.ok(content.includes("order_index"))
assert.ok(content.includes("mention_refs"))
assert.ok(content.includes("video_url"))
assert.ok(content.includes("video_batch_id"))
assert.ok(content.includes("video_task_id"))
console.log('✓ 创建 short_drama_segments 表并包含片段视频任务字段')

assert.ok(content.includes('uq_short_drama_segments_project_episode_segment'))
assert.ok(content.includes('idx_short_drama_segments_project_episode_order'))
assert.ok(content.includes('idx_short_drama_segments_project_status'))
console.log('✓ 包含项目内唯一约束和常用查询索引')

assert.ok(content.includes('jsonb_array_elements'))
assert.ok(content.includes("'episodes'"))
assert.ok(content.includes("'segments'"))
assert.ok(content.includes('ON CONFLICT'))
console.log('✓ 从旧 state JSON 回填已有分集片段')

assert.ok(content.includes("dropTable('short_drama_segments')"))
console.log('✓ down 会删除 short_drama_segments 表')

console.log('\n✅ 短剧片段结构化迁移测试通过！')
