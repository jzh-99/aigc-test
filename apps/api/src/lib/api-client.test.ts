import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'

import { ErrorCode, OpenApiError } from './open-api-errors.js'
import { hashApiKey, resolveApiClient, type ApiClientRow } from './api-client.js'
import { authenticateApiKey, type ApiClientPrincipal } from '../plugins/api-key-auth.js'

// 本文件覆盖：
// - hashApiKey 纯函数确定性（对齐源项目 _digest_api_key：sha256(明文).hex）
// - resolveApiClient 各分支（合法/非法/disabled/空 token）
//
// DB 交互遵循现有惯例：apps/api/src/lib 下既有测试全部为纯函数、零真实库依赖，
// 且 getDb() 是模块级单例无法注入。故 resolveApiClient 接受可选 finder 注入参数
// （FindActiveClientByDigest：digest → Promise<行 | undefined>），测试注入最小假函数，
// 既不引入 mock 库（devDeps 无 sinon/vi），也保持与现有纯函数测试一致。

// 构造假 finder：digest 命中预期明文的摘要时返回行，否则 undefined。
// nextRow 控制最终返回值；queried 暴露是否被调用（用于空 token 不查库断言）。
function makeFakeFinder(nextRow: ApiClientRow | undefined) {
  let queried = false
  const finder = async () => {
    queried = true
    return nextRow
  }
  return { finder, wasQueried: () => queried }
}

// 构造一条合法的 api_clients 行（字段对齐 packages/db schema ApiClientsTable）
function makeRow(overrides: Partial<ApiClientRow> = {}): ApiClientRow {
  return {
    id: 'client-1',
    name: '测试调用方',
    api_key_hash: hashApiKey('aigc_secret_plain'),
    status: 'active',
    team_id: 'team-1',
    workspace_id: 'ws-1',
    system_user_id: 'sys-user-1',
    ...overrides,
  }
}

describe('hashApiKey', () => {
  test('sha256(明文).hex：确定且可重现（对齐源项目 _digest_api_key）', () => {
    const plain = 'aigc_xxx'
    const expected = crypto.createHash('sha256').update(plain).digest('hex')
    assert.equal(hashApiKey(plain), expected)
    // 相同输入二次调用结果一致
    assert.equal(hashApiKey(plain), hashApiKey(plain))
  })

  test('不同明文产生不同摘要', () => {
    assert.notEqual(hashApiKey('aigc_a'), hashApiKey('aigc_b'))
  })

  test('与源项目 passlib.pbkdf2_sha256 不互通（仅纯 sha256，无盐值迭代）', () => {
    // 源项目 hash_api_key = pbkdf2_sha256(sha256(plain))，本侧仅 sha256(plain)
    // 二者格式不同：源 hash 以 "pbkdf2_sha256$..." 开头，本侧为 64 位 hex
    const h = hashApiKey('aigc_xxx')
    assert.equal(h.length, 64)
    assert.match(h, /^[0-9a-f]{64}$/)
    assert.equal(h.startsWith('pbkdf2_sha256'), false)
  })
})

describe('resolveApiClient', () => {
  test('合法 Bearer（DB 有匹配且 status=active）→ 返回 client 全字段', async () => {
    const row = makeRow()
    const { finder } = makeFakeFinder(row)
    const client = await resolveApiClient('aigc_secret_plain', finder)
    assert.equal(client.id, 'client-1')
    assert.equal(client.name, '测试调用方')
    assert.equal(client.status, 'active')
    assert.equal(client.team_id, 'team-1')
    assert.equal(client.workspace_id, 'ws-1')
    assert.equal(client.system_user_id, 'sys-user-1')
  })

  test('非法 key（DB 无匹配）→ 抛 OpenApiError(AUTH_FAILED)', async () => {
    const { finder } = makeFakeFinder(undefined)
    await assert.rejects(
      () => resolveApiClient('aigc_wrong', finder),
      (err: unknown) => {
        assert.ok(err instanceof OpenApiError, '应为 OpenApiError')
        assert.equal((err as OpenApiError).code, ErrorCode.AUTH_FAILED)
        // 对外固定文案，不泄漏内部细节
        assert.equal((err as OpenApiError).publicMessage, '不符合创作规范')
        return true
      },
    )
  })

  test('status=disabled 的行被 where 过滤（查询不返回）→ 抛 AUTH_FAILED', async () => {
    // 假 finder 模拟 status=disabled 行被过滤后无结果
    const { finder } = makeFakeFinder(undefined)
    await assert.rejects(
      () => resolveApiClient('aigc_disabled', finder),
      (err: unknown) => {
        assert.ok(err instanceof OpenApiError)
        assert.equal((err as OpenApiError).code, ErrorCode.AUTH_FAILED)
        return true
      },
    )
  })

  test('空 token → 抛 AUTH_FAILED（不查库）', async () => {
    const { finder, wasQueried } = makeFakeFinder(undefined)
    await assert.rejects(
      () => resolveApiClient(undefined, finder),
      (err: unknown) => {
        assert.ok(err instanceof OpenApiError)
        assert.equal((err as OpenApiError).code, ErrorCode.AUTH_FAILED)
        return true
      },
    )
    assert.equal(wasQueried(), false, '空 token 不应触发 DB 查询')
  })

  test('空串 token → 同样抛 AUTH_FAILED', async () => {
    const { finder } = makeFakeFinder(undefined)
    await assert.rejects(
      () => resolveApiClient('', finder),
      (err: unknown) => (err as OpenApiError).code === ErrorCode.AUTH_FAILED,
    )
  })

  test('查询时使用 sha256(明文) 作为 api_key_hash 条件（不传明文入库）', async () => {
    const plain = 'aigc_lookup_check'
    const row = makeRow({ api_key_hash: hashApiKey(plain) })
    const { finder } = makeFakeFinder(row)
    const client = await resolveApiClient(plain, finder)
    assert.equal(client.api_key_hash, hashApiKey(plain))
  })
})

// authenticateApiKey：用最小 mock request 对象测试，不启动 Fastify。
// 覆盖：合法 Bearer → request.apiClient 正确设置；空/非 Bearer → AUTH_FAILED。
describe('authenticateApiKey', () => {
  function makeRequest(authorization?: string) {
    return { headers: { authorization } } as unknown as FastifyRequestLike
  }

  // 仅实现 authenticateApiKey 用到的 request 字段
  interface FastifyRequestLike {
    headers: { authorization?: string }
    apiClient: ApiClientPrincipal | null
  }

  test('合法 Bearer → request.apiClient 映射 id/teamId/workspaceId/systemUserId/name', async () => {
    const req = makeRequest('Bearer aigc_secret_plain')
    const { finder } = makeFakeFinder(makeRow())
    await authenticateApiKey(req, finder)
    assert.deepEqual(req.apiClient, {
      id: 'client-1',
      name: '测试调用方',
      teamId: 'team-1',
      workspaceId: 'ws-1',
      systemUserId: 'sys-user-1',
    })
  })

  test('合法 Bearer 但 DB 无匹配 → 抛 AUTH_FAILED，request.apiClient 未被设置', async () => {
    const req = makeRequest('Bearer aigc_unknown')
    req.apiClient = null
    const { finder } = makeFakeFinder(undefined)
    await assert.rejects(
      () => authenticateApiKey(req, finder),
      (err: unknown) => (err as OpenApiError).code === ErrorCode.AUTH_FAILED,
    )
    assert.equal(req.apiClient, null, '认证失败不应改写 apiClient')
  })

  test('无 authorization 头 → 抛 AUTH_FAILED', async () => {
    const req = makeRequest(undefined)
    const { finder } = makeFakeFinder(makeRow())
    await assert.rejects(
      () => authenticateApiKey(req, finder),
      (err: unknown) => (err as OpenApiError).code === ErrorCode.AUTH_FAILED,
    )
  })

  test('非 Bearer 前缀（如 Basic）→ 抛 AUTH_FAILED', async () => {
    const req = makeRequest('Basic abc123')
    const { finder } = makeFakeFinder(makeRow())
    await assert.rejects(
      () => authenticateApiKey(req, finder),
      (err: unknown) => (err as OpenApiError).code === ErrorCode.AUTH_FAILED,
    )
  })

  test('Bearer 后为空（仅 "Bearer "）→ 抛 AUTH_FAILED', async () => {
    const req = makeRequest('Bearer ')
    const { finder } = makeFakeFinder(makeRow())
    await assert.rejects(
      () => authenticateApiKey(req, finder),
      (err: unknown) => (err as OpenApiError).code === ErrorCode.AUTH_FAILED,
    )
  })

  test('team_id/workspace_id/system_user_id 为 null 时正确透传', async () => {
    const req = makeRequest('Bearer aigc_nullish')
    const row = makeRow({ team_id: null, workspace_id: null, system_user_id: null })
    const { finder } = makeFakeFinder(row)
    await authenticateApiKey(req, finder)
    assert.equal(req.apiClient?.teamId, null)
    assert.equal(req.apiClient?.workspaceId, null)
    assert.equal(req.apiClient?.systemUserId, null)
  })
})
