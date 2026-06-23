import crypto from 'node:crypto'

import { getDb } from '@aigc/db'

import { ErrorCode, OpenApiError } from './open-api-errors.js'

// api_clients 表行类型（Kysely Selectable 形状，对齐 packages/db schema ApiClientsTable）
export interface ApiClientRow {
  id: string
  name: string
  api_key_hash: string
  status: 'active' | 'disabled'
  team_id: string | null
  workspace_id: string | null
  system_user_id: string | null
}

// 查询器：按 digest 查 status=active 的 api_clients 行，返回行或 undefined。
// 抽象为单一函数以与 Kysely 复杂重载类型解耦，便于测试注入最小假函数。
// - 生产路径 findActiveClientByDigest 默认用 getDb() 构建 Kysely 查询
// - 测试路径注入纯函数实现，保持现有「纯函数测试、无真实库」惯例
export type FindActiveClientByDigest = (digest: string) => Promise<ApiClientRow | undefined>

// 默认查询实现：走 Kysely 链。从 getDb() 取单例连接（packages/db client.ts 的模块级缓存）。
async function findActiveClientByDigestDefault(digest: string): Promise<ApiClientRow | undefined> {
  return getDb()
    .selectFrom('api_clients')
    .selectAll()
    .where('api_key_hash', '=', digest)
    .where('status', '=', 'active')
    .executeTakeFirst()
}

// 明文 key 经 sha256 得摘要存库（对齐源项目 app/services/auth.py 的 _digest_api_key）。
// 注意：源项目在此基础上再用 passlib.pbkdf2_sha256 包一层，本侧按锁定决策仅用纯 sha256，
//       故与源 hash 不互通——迁移时需为现有调用方重新签发 key。
export function hashApiKey(plain: string): string {
  return crypto.createHash('sha256').update(plain).digest('hex')
}

// 解析 Bearer token → sha256 → 查 api_clients(status=active) → 返回归属主体行。
// 无匹配或 status!=active 均抛 AUTH_FAILED，对外固定文案，不泄漏内部细节。
// finder 仅用于测试注入，生产调用省略（走默认 Kysely 实现）。
export async function resolveApiClient(
  bearerToken: string | undefined,
  finder: FindActiveClientByDigest = findActiveClientByDigestDefault,
): Promise<ApiClientRow> {
  if (!bearerToken) throw new OpenApiError(ErrorCode.AUTH_FAILED)

  const digest = hashApiKey(bearerToken)
  const client = await finder(digest)
  if (!client) throw new OpenApiError(ErrorCode.AUTH_FAILED)
  return client
}
