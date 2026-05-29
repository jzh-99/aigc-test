import { strict as assert } from 'node:assert'
import {
  extractShortDramaJsonObject,
  validateShortDramaEpisodeCount,
  validateShortDramaDuration,
  calculateShortDramaTextCredits,
  makeShortDramaSourceMetadata,
  SHORT_DRAMA_SOURCE_MODULE,
  SHORT_DRAMA_SOURCE_FEATURE,
} from '../routes/short-drama/_shared.js'

// ============================================================================
// Test: extractShortDramaJsonObject
// ============================================================================

console.log('测试 extractShortDramaJsonObject...')

// 测试 fenced code block 格式
const fencedInput = '```json\n{"title":"短剧","items":[]}\n```'
const fencedResult = extractShortDramaJsonObject(fencedInput)
assert.deepEqual(fencedResult, { title: '短剧', items: [] })
console.log('✓ 可以解析 fenced json')

// 测试带解释文字的 fenced code block
const fencedWithText = '这是生成的短剧大纲：\n```json\n{"title":"测试","count":5}\n```\n希望对你有帮助'
const fencedWithTextResult = extractShortDramaJsonObject(fencedWithText)
assert.deepEqual(fencedWithTextResult, { title: '测试', count: 5 })
console.log('✓ 可以从带解释文字的响应中提取 fenced json')

// 测试普通 JSON 对象
const plainJson = '{"title":"普通短剧","episodes":10}'
const plainResult = extractShortDramaJsonObject(plainJson)
assert.deepEqual(plainResult, { title: '普通短剧', episodes: 10 })
console.log('✓ 可以解析普通 JSON 对象')

// 测试无效输入
try {
  extractShortDramaJsonObject('这不是 JSON')
  assert.fail('应该抛出错误')
} catch (error) {
  assert.ok((error as Error).message.includes('AI 返回格式错误，请重试'))
  console.log('✓ 无效输入抛出正确错误')
}

// ============================================================================
// Test: validateShortDramaEpisodeCount
// ============================================================================

console.log('\n测试 validateShortDramaEpisodeCount...')

// 测试有效集数
assert.equal(validateShortDramaEpisodeCount(1), 1)
assert.equal(validateShortDramaEpisodeCount(25), 25)
assert.equal(validateShortDramaEpisodeCount(50), 50)
console.log('✓ 有效集数通过校验')

// 测试超出范围
try {
  validateShortDramaEpisodeCount(51)
  assert.fail('应该抛出错误')
} catch (error) {
  assert.ok((error as Error).message.includes('集数必须在 1 到 50 之间'))
  console.log('✓ 集数 51 抛出正确错误')
}

try {
  validateShortDramaEpisodeCount(0)
  assert.fail('应该抛出错误')
} catch (error) {
  assert.ok((error as Error).message.includes('集数必须在 1 到 50 之间'))
  console.log('✓ 集数 0 抛出正确错误')
}

// 测试非整数
try {
  validateShortDramaEpisodeCount(10.5)
  assert.fail('应该抛出错误')
} catch (error) {
  assert.ok((error as Error).message.includes('集数必须是整数'))
  console.log('✓ 非整数抛出正确错误')
}

// 测试非数字
try {
  validateShortDramaEpisodeCount('10')
  assert.fail('应该抛出错误')
} catch (error) {
  assert.ok((error as Error).message.includes('集数必须是整数'))
  console.log('✓ 非数字抛出正确错误')
}

// ============================================================================
// Test: validateShortDramaDuration
// ============================================================================

console.log('\n测试 validateShortDramaDuration...')

// 测试有效时长
const allowedDurations = [4, 5, 8]
validateShortDramaDuration(4, allowedDurations)
validateShortDramaDuration(5, allowedDurations)
validateShortDramaDuration(8, allowedDurations)
console.log('✓ 有效时长通过校验')

// 测试不支持的时长
try {
  validateShortDramaDuration(6, [4, 5, 8])
  assert.fail('应该抛出错误')
} catch (error) {
  const message = (error as Error).message
  assert.ok(message.includes('当前模型不支持 6 秒'))
  assert.ok(message.includes('4、5、8'))
  console.log('✓ 不支持的时长抛出正确错误')
}

// ============================================================================
// Test: calculateShortDramaTextCredits
// ============================================================================

console.log('\n测试 calculateShortDramaTextCredits...')

// 测试基本计算
assert.equal(calculateShortDramaTextCredits(1, 1), 1)
assert.equal(calculateShortDramaTextCredits(500, 1), 1)
assert.equal(calculateShortDramaTextCredits(1000, 1), 1)
assert.equal(calculateShortDramaTextCredits(1001, 1), 2)
assert.equal(calculateShortDramaTextCredits(2000, 1), 2)
assert.equal(calculateShortDramaTextCredits(2001, 1), 3)
console.log('✓ 基本计算正确（每千字 1 积分）')

// 测试不同积分率
assert.equal(calculateShortDramaTextCredits(1000, 2), 2)
assert.equal(calculateShortDramaTextCredits(1500, 2), 4)
assert.equal(calculateShortDramaTextCredits(3000, 3), 9)
console.log('✓ 不同积分率计算正确')

// 测试边界情况
assert.equal(calculateShortDramaTextCredits(0, 1), 1)
assert.equal(calculateShortDramaTextCredits(-100, 1), 1)
console.log('✓ 边界情况返回最低 1 积分')

// ============================================================================
// Test: makeShortDramaSourceMetadata
// ============================================================================

console.log('\n测试 makeShortDramaSourceMetadata...')

// 测试完整参数
const fullMetadata = makeShortDramaSourceMetadata({
  projectId: 'p1',
  episodeId: 'e1',
  segmentId: 's1',
})
assert.equal(fullMetadata.source_module, 'toby_studio')
assert.equal(fullMetadata.source_feature, 'short_drama')
assert.equal(fullMetadata.source_project_id, 'p1')
assert.equal(fullMetadata.source_episode_id, 'e1')
assert.equal(fullMetadata.source_segment_id, 's1')
console.log('✓ 完整参数生成正确的 metadata')

// 测试部分参数
const partialMetadata = makeShortDramaSourceMetadata({
  projectId: 'p2',
})
assert.equal(partialMetadata.source_module, SHORT_DRAMA_SOURCE_MODULE)
assert.equal(partialMetadata.source_feature, SHORT_DRAMA_SOURCE_FEATURE)
assert.equal(partialMetadata.source_project_id, 'p2')
assert.equal(partialMetadata.source_episode_id, null)
assert.equal(partialMetadata.source_segment_id, null)
console.log('✓ 部分参数生成正确的 metadata（可选字段为 null）')

// 测试只有 episodeId
const episodeOnlyMetadata = makeShortDramaSourceMetadata({
  projectId: 'p3',
  episodeId: 'e3',
})
assert.equal(episodeOnlyMetadata.source_project_id, 'p3')
assert.equal(episodeOnlyMetadata.source_episode_id, 'e3')
assert.equal(episodeOnlyMetadata.source_segment_id, null)
console.log('✓ 只有 episodeId 时 segmentId 为 null')

// ============================================================================
// Summary
// ============================================================================

console.log('\n✅ 所有测试通过！')
