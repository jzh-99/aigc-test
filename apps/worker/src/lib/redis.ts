import Redis from 'ioredis'

let _redis: Redis | null = null

/**
 * Lazy Redis singleton — reads REDIS_URL after dotenv has loaded.
 * Reuses the same connection across the worker process.
 */
export function getRedis(): Redis {
  if (!_redis) {
    _redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
      maxRetriesPerRequest: null,
    })
  }
  return _redis
}

let _pubRedis: Redis | null = null

/**
 * Separate Redis connection for Pub/Sub (can't share with queue connections).
 */
export function getPubRedis(): Redis {
  if (!_pubRedis) {
    _pubRedis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379')
  }
  return _pubRedis
}

export async function closeRedis(): Promise<void> {
  await _redis?.quit()
  await _pubRedis?.quit()
  _redis = null
  _pubRedis = null
}
