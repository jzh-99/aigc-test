import { Queue } from 'bullmq'
import type { RedisOptions } from 'ioredis'
import type { MusicJobData, MusicVoiceCloneJobData, OpenApiCallbackJobData, PodcastJobData, StorybookJobData } from '@aigc/types'

const DEFAULT_JOB_OPTIONS = {
  removeOnComplete: { age: 24 * 60 * 60, count: 1000 },
  removeOnFail: { age: 7 * 24 * 60 * 60, count: 5000 },
}

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
// 开放接口异步回调队列（worker 消费）
let _openApiCallbackQueue: Queue<OpenApiCallbackJobData> | null = null
// 开放接口绘本生成队列（storybook worker 消费，Phase 4）
let _storybookQueue: Queue<StorybookJobData> | null = null
// 开放接口播客生成队列（podcast worker 消费，Phase 5）
let _podcastQueue: Queue<PodcastJobData> | null = null

type CloseableQueue = Pick<Queue, 'close'>

export function __setQueuesForTest(queues: {
  imageQueue?: CloseableQueue | null
  transferQueue?: CloseableQueue | null
  videoQueue?: CloseableQueue | null
  storyboardQueue?: CloseableQueue | null
  musicQueue?: CloseableQueue | null
  musicVoiceCloneQueue?: CloseableQueue | null
  openApiCallbackQueue?: CloseableQueue | null
  storybookQueue?: CloseableQueue | null
  podcastQueue?: CloseableQueue | null
}): void {
  _imageQueue = (queues.imageQueue as Queue | null | undefined) ?? null
  _transferQueue = (queues.transferQueue as Queue | null | undefined) ?? null
  _videoQueue = (queues.videoQueue as Queue | null | undefined) ?? null
  _storyboardQueue = (queues.storyboardQueue as Queue | null | undefined) ?? null
  _musicQueue = (queues.musicQueue as Queue<MusicJobData> | null | undefined) ?? null
  _musicVoiceCloneQueue = (queues.musicVoiceCloneQueue as Queue<MusicVoiceCloneJobData> | null | undefined) ?? null
  _openApiCallbackQueue = (queues.openApiCallbackQueue as Queue<OpenApiCallbackJobData> | null | undefined) ?? null
  _storybookQueue = (queues.storybookQueue as Queue<StorybookJobData> | null | undefined) ?? null
  _podcastQueue = (queues.podcastQueue as Queue<PodcastJobData> | null | undefined) ?? null
}

export function getImageQueue(): Queue {
  if (!_imageQueue) {
    _imageQueue = new Queue('image-queue', { connection: getRedisOptions(), defaultJobOptions: DEFAULT_JOB_OPTIONS })
  }
  return _imageQueue
}

export function getTransferQueue(): Queue {
  if (!_transferQueue) {
    _transferQueue = new Queue('transfer-queue', { connection: getRedisOptions(), defaultJobOptions: DEFAULT_JOB_OPTIONS })
  }
  return _transferQueue
}

export function getVideoQueue(): Queue {
  if (!_videoQueue) {
    _videoQueue = new Queue('video-queue', { connection: getRedisOptions(), defaultJobOptions: DEFAULT_JOB_OPTIONS })
  }
  return _videoQueue
}

export function getStoryboardQueue(): Queue {
  if (!_storyboardQueue) {
    _storyboardQueue = new Queue('storyboard-queue', { connection: getRedisOptions(), defaultJobOptions: DEFAULT_JOB_OPTIONS })
  }
  return _storyboardQueue
}

export function getMusicQueue(): Queue<MusicJobData> {
  if (!_musicQueue) {
    _musicQueue = new Queue<MusicJobData>('music-queue', { connection: getRedisOptions(), defaultJobOptions: DEFAULT_JOB_OPTIONS })
  }
  return _musicQueue
}

export function getMusicVoiceCloneQueue(): Queue<MusicVoiceCloneJobData> {
  if (!_musicVoiceCloneQueue) {
    _musicVoiceCloneQueue = new Queue<MusicVoiceCloneJobData>('music-voice-clone-queue', { connection: getRedisOptions(), defaultJobOptions: DEFAULT_JOB_OPTIONS })
  }
  return _musicVoiceCloneQueue
}

export function getShortDramaExportQueue(): Queue {
  if (!_shortDramaExportQueue) {
    _shortDramaExportQueue = new Queue('short-drama-export-queue', { connection: getRedisOptions(), defaultJobOptions: DEFAULT_JOB_OPTIONS })
  }
  return _shortDramaExportQueue
}

// 开放接口绘本生成队列：worker 侧通过同名队列消费（Phase 4）
export function getStorybookQueue(): Queue<StorybookJobData> {
  if (!_storybookQueue) {
    _storybookQueue = new Queue<StorybookJobData>('storybook-queue', {
      connection: getRedisOptions(),
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    })
  }
  return _storybookQueue
}

// 开放接口回调队列：worker 侧通过同名队列消费
export function getOpenApiCallbackQueue(): Queue<OpenApiCallbackJobData> {
  if (!_openApiCallbackQueue) {
    _openApiCallbackQueue = new Queue<OpenApiCallbackJobData>('open-api-callback-queue', {
      connection: getRedisOptions(),
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    })
  }
  return _openApiCallbackQueue
}

// 开放接口播客生成队列：worker 侧通过同名队列消费（Phase 5）
export function getPodcastQueue(): Queue<PodcastJobData> {
  if (!_podcastQueue) {
    _podcastQueue = new Queue<PodcastJobData>('podcast-queue', {
      connection: getRedisOptions(),
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    })
  }
  return _podcastQueue
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
    _openApiCallbackQueue,
    _storybookQueue,
    _podcastQueue,
  ]

  _imageQueue = null
  _transferQueue = null
  _videoQueue = null
  _storyboardQueue = null
  _musicQueue = null
  _musicVoiceCloneQueue = null
  _shortDramaExportQueue = null
  _openApiCallbackQueue = null
  _storybookQueue = null
  _podcastQueue = null

  await Promise.all(queues.map((queue) => queue?.close()))
}
