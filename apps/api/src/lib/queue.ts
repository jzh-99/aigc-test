import { Queue } from 'bullmq'
import type { RedisOptions } from 'ioredis'
import type { MusicJobData, MusicVoiceCloneJobData } from '@aigc/types'

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
let _storyboardQueue: Queue | null = null
let _musicQueue: Queue<MusicJobData> | null = null
let _musicVoiceCloneQueue: Queue<MusicVoiceCloneJobData> | null = null
let _shortDramaExportQueue: Queue | null = null

type CloseableQueue = Pick<Queue, 'close'>

export function __setQueuesForTest(queues: {
  imageQueue?: CloseableQueue | null
  transferQueue?: CloseableQueue | null
  videoQueue?: CloseableQueue | null
  storyboardQueue?: CloseableQueue | null
  musicQueue?: CloseableQueue | null
  musicVoiceCloneQueue?: CloseableQueue | null
}): void {
  _imageQueue = (queues.imageQueue as Queue | null | undefined) ?? null
  _transferQueue = (queues.transferQueue as Queue | null | undefined) ?? null
  _videoQueue = (queues.videoQueue as Queue | null | undefined) ?? null
  _storyboardQueue = (queues.storyboardQueue as Queue | null | undefined) ?? null
  _musicQueue = (queues.musicQueue as Queue<MusicJobData> | null | undefined) ?? null
  _musicVoiceCloneQueue = (queues.musicVoiceCloneQueue as Queue<MusicVoiceCloneJobData> | null | undefined) ?? null
}

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

export function getStoryboardQueue(): Queue {
  if (!_storyboardQueue) {
    _storyboardQueue = new Queue('storyboard-queue', { connection: getRedisOptions() })
  }
  return _storyboardQueue
}

export function getMusicQueue(): Queue<MusicJobData> {
  if (!_musicQueue) {
    _musicQueue = new Queue<MusicJobData>('music-queue', { connection: getRedisOptions() })
  }
  return _musicQueue
}

export function getMusicVoiceCloneQueue(): Queue<MusicVoiceCloneJobData> {
  if (!_musicVoiceCloneQueue) {
    _musicVoiceCloneQueue = new Queue<MusicVoiceCloneJobData>('music-voice-clone-queue', { connection: getRedisOptions() })
  }
  return _musicVoiceCloneQueue
}

export function getShortDramaExportQueue(): Queue {
  if (!_shortDramaExportQueue) {
    _shortDramaExportQueue = new Queue('short-drama-export-queue', { connection: getRedisOptions() })
  }
  return _shortDramaExportQueue
}

export async function closeQueues(): Promise<void> {
  const queues = [
    _imageQueue,
    _transferQueue,
    _videoQueue,
    _storyboardQueue,
    _musicQueue,
    _musicVoiceCloneQueue,
    _shortDramaExportQueue,
  ]

  _imageQueue = null
  _transferQueue = null
  _videoQueue = null
  _storyboardQueue = null
  _musicQueue = null
  _musicVoiceCloneQueue = null
  _shortDramaExportQueue = null

  await Promise.all(queues.map((queue) => queue?.close()))
}
