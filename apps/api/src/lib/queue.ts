import { Queue } from 'bullmq'
import Redis from 'ioredis'

let _connection: Redis | null = null
function getConnection(): Redis {
  if (!_connection) {
    _connection = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
      maxRetriesPerRequest: null,
    })
  }
  return _connection
}

let _imageQueue: Queue | null = null
let _transferQueue: Queue | null = null

export function getImageQueue(): Queue {
  if (!_imageQueue) {
    _imageQueue = new Queue('image-queue', { connection: getConnection() })
  }
  return _imageQueue
}

export function getTransferQueue(): Queue {
  if (!_transferQueue) {
    _transferQueue = new Queue('transfer-queue', { connection: getConnection() })
  }
  return _transferQueue
}
