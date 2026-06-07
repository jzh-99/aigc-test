import 'dotenv/config'
import { Queue } from 'bullmq'
import { getBullMQConnection } from '../lib/redis.js'

const DEFAULT_QUEUES = [
  'image-queue',
  'transfer-queue',
  'video-queue',
  'storyboard-queue',
  'music-queue',
  'music-voice-clone-queue',
  'short-drama-export-queue',
  'cron-queue',
] as const

type CleanState = 'completed' | 'failed'

type CleanOptions = {
  queues: string[]
  states: CleanState[]
  graceMs: number
  limit: number
  dryRun: boolean
}

function printHelp(): void {
  console.log(`
Usage:
  pnpm queue:clean [options]
  pnpm --filter @aigc/worker queue:clean -- [options]

Options:
  --queue <name|all>      Queue name to clean. Can be repeated. Default: all.
  --state <state|all>     completed, failed, or all. Can be repeated. Default: all.
  --grace <ms>            Only clean jobs older than this many ms. Default: 0.
  --limit <count>         Max jobs to clean per queue/state. Default: 100000.
  --dry-run               Print counts without deleting jobs.
  --help                  Show this help.
`.trim())
}

function readArgValue(args: string[], index: number, name: string): string {
  const value = args[index + 1]
  if (!value || value.startsWith('--')) {
    throw new Error(`${name} requires a value`)
  }
  return value
}

function parseArgs(args: string[]): CleanOptions {
  const queues: string[] = []
  const states: CleanState[] = []
  let graceMs = 0
  let limit = 100000
  let dryRun = false

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    if (arg === '--help' || arg === '-h') {
      printHelp()
      process.exit(0)
    }

    if (arg === '--dry-run') {
      dryRun = true
      continue
    }

    if (arg === '--queue') {
      const value = readArgValue(args, i, arg)
      if (value === 'all') {
        queues.length = 0
      } else {
        queues.push(value)
      }
      i += 1
      continue
    }

    if (arg === '--state') {
      const value = readArgValue(args, i, arg)
      if (value === 'all') {
        states.length = 0
      } else if (value === 'completed' || value === 'failed') {
        states.push(value)
      } else {
        throw new Error(`Unsupported state: ${value}`)
      }
      i += 1
      continue
    }

    if (arg === '--grace') {
      graceMs = Number(readArgValue(args, i, arg))
      i += 1
      continue
    }

    if (arg === '--limit') {
      limit = Number(readArgValue(args, i, arg))
      i += 1
      continue
    }

    throw new Error(`Unknown option: ${arg}`)
  }

  if (!Number.isFinite(graceMs) || graceMs < 0) {
    throw new Error('--grace must be a non-negative number')
  }
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error('--limit must be a positive integer')
  }

  return {
    queues: queues.length > 0 ? [...new Set(queues)] : [...DEFAULT_QUEUES],
    states: states.length > 0 ? [...new Set(states)] : ['completed', 'failed'],
    graceMs,
    limit,
    dryRun,
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))
  const connection = getBullMQConnection()
  const results: Array<Record<string, string | number>> = []

  for (const queueName of options.queues) {
    const queue = new Queue(queueName, { connection })
    try {
      const counts = await queue.getJobCounts('completed', 'failed', 'waiting', 'active', 'delayed')

      for (const state of options.states) {
        const before = counts[state] ?? 0
        const cleaned = options.dryRun ? [] : await queue.clean(options.graceMs, options.limit, state)
        results.push({
          queue: queueName,
          state,
          before,
          cleaned: options.dryRun ? 0 : cleaned.length,
          mode: options.dryRun ? 'dry-run' : 'clean',
          waiting: counts.waiting ?? 0,
          active: counts.active ?? 0,
          delayed: counts.delayed ?? 0,
        })
      }
    } finally {
      await queue.close()
    }
  }

  console.table(results)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
