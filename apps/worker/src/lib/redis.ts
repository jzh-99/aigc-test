import RedisLib from 'ioredis'

type RedisType = any

let _redis: RedisType | null = null

/**
 * Lazy Redis singleton — reads REDIS_URL after dotenv has loaded.
 * Reuses the same connection across the worker process.
 */
export function getRedis(): RedisType {
  if (!_redis) {
    _redis = new (RedisLib as any)(process.env.REDIS_URL ?? 'redis://localhost:6379', {
      maxRetriesPerRequest: null,
    })
  }
  return _redis
}

let _pubRedis: RedisType | null = null

/**
 * Separate Redis connection for Pub/Sub (can't share with queue connections).
 */
export function getPubRedis(): RedisType {
  if (!_pubRedis) {
    _pubRedis = new (RedisLib as any)(process.env.REDIS_URL ?? 'redis://localhost:6379')
  }
  return _pubRedis
}

export async function closeRedis(): Promise<void> {
  await _redis?.quit()
  await _pubRedis?.quit()
  _redis = null
  _pubRedis = null
}
