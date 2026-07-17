import RedisLib from 'ioredis'
import type { RedisOptions } from 'ioredis'

type RedisType = any

// 延迟解析 REDIS_URL：模块顶层不能读 process.env，因为 ESM import 在 dotenv config() 之前执行
// 必须在函数内部（运行时）才读取，此时 dotenv 已加载完毕
function getRedisOptions(): RedisOptions {
  const url = process.env.REDIS_URL ?? 'redis://localhost:6379'
  try {
    const parsed = new URL(url)
    const db = parseInt(parsed.pathname.replace('/', ''), 10)
    return {
      host: parsed.hostname || 'localhost',
      port: parseInt(parsed.port, 10) || 6379,
      db: isNaN(db) ? 0 : db,
      ...(parsed.password ? { password: decodeURIComponent(parsed.password) } : {}),
      ...(parsed.username ? { username: decodeURIComponent(parsed.username) } : {}),
    }
  } catch {
    return { host: 'localhost', port: 6379, db: 0 }
  }
}

let _redis: RedisType | null = null

export function getRedis(): RedisType {
  if (!_redis) {
    _redis = new (RedisLib as any)({ ...getRedisOptions(), maxRetriesPerRequest: null })
  }
  return _redis
}

// 供 BullMQ Worker/Queue 使用：传 options 对象而非实例，避免 duplicate() 丢失 db
export function getBullMQConnection(): RedisOptions & { maxRetriesPerRequest: null } {
  return { ...getRedisOptions(), maxRetriesPerRequest: null }
}

let _pubRedis: RedisType | null = null

export function getPubRedis(): RedisType {
  if (!_pubRedis) {
    _pubRedis = new (RedisLib as any)(getRedisOptions())
  }
  return _pubRedis
}

export async function closeRedis(): Promise<void> {
  await _redis?.quit()
  await _pubRedis?.quit()
  _redis = null
  _pubRedis = null
}
