import { randomUUID } from 'node:crypto'
import type { Redis } from 'ioredis'

export interface RedisLockHandle {
  key: string
  value: string
  renewTimer?: ReturnType<typeof setInterval>
}

export interface RedisLockOptions {
  ttlSeconds?: number
  autoRenew?: boolean
  renewIntervalMs?: number
}

const RELEASE_LOCK_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
end
return 0
`

const RENEW_LOCK_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("EXPIRE", KEYS[1], ARGV[2])
end
return 0
`

function normalizeLockOptions(options?: number | RedisLockOptions): Required<RedisLockOptions> {
  if (typeof options === 'number') {
    return {
      ttlSeconds: options,
      autoRenew: true,
      renewIntervalMs: Math.max(1000, Math.floor(options * 1000 / 3)),
    }
  }

  const ttlSeconds = options?.ttlSeconds ?? 3600
  return {
    ttlSeconds,
    autoRenew: options?.autoRenew ?? true,
    renewIntervalMs: options?.renewIntervalMs ?? Math.max(1000, Math.floor(ttlSeconds * 1000 / 3)),
  }
}

export async function acquireRedisLock(
  redis: Redis,
  key: string,
  options?: number | RedisLockOptions,
): Promise<RedisLockHandle | null> {
  const normalized = normalizeLockOptions(options)
  const value = randomUUID()
  const result = await redis.set(key, value, 'EX', normalized.ttlSeconds, 'NX')
  if (result !== 'OK') return null

  const lock: RedisLockHandle = { key, value }
  if (normalized.autoRenew) {
    lock.renewTimer = setInterval(() => {
      void renewRedisLock(redis, lock, normalized.ttlSeconds).catch(() => {})
    }, normalized.renewIntervalMs)
    lock.renewTimer.unref?.()
  }

  return lock
}

export async function renewRedisLock(redis: Redis, lock: RedisLockHandle | null, ttlSeconds = 3600): Promise<boolean> {
  if (!lock) return false
  const result = await redis.eval(RENEW_LOCK_SCRIPT, 1, lock.key, lock.value, String(ttlSeconds))
  return result === 1
}

export async function releaseRedisLock(redis: Redis, lock: RedisLockHandle | null): Promise<void> {
  if (!lock) return
  if (lock.renewTimer) {
    clearInterval(lock.renewTimer)
    lock.renewTimer = undefined
  }
  await redis.eval(RELEASE_LOCK_SCRIPT, 1, lock.key, lock.value)
}
