import { Queue } from 'bullmq'
import type { RedisOptions } from 'ioredis'

// 延迟解析 REDIS_URL：模块顶层不能读 process.env，因为 ESM import 在 dotenv config() 之前执行
function getRedisOptions(): RedisOptions & { maxRetriesPerRequest: null } {
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
      maxRetriesPerRequest: null,
    }
  } catch {
    return { host: 'localhost', port: 6379, db: 0, maxRetriesPerRequest: null }
  }
}

let _imageQueue: Queue | null = null
let _transferQueue: Queue | null = null
let _videoQueue: Queue | null = null

export function getImageQueue(): Queue {
  if (!_imageQueue) {
    _imageQueue = new Queue('image-queue', { connection: getRedisOptions() })
  }
  return _imageQueue
}

export function getTransferQueue(): Queue {
  if (!_transferQueue) {
    _transferQueue = new Queue('transfer-queue', { connection: getRedisOptions() })
  }
  return _transferQueue
}

export function getVideoQueue(): Queue {
  if (!_videoQueue) {
    _videoQueue = new Queue('video-queue', { connection: getRedisOptions() })
  }
  return _videoQueue
}
