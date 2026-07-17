import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pino } from 'pino'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const LOG_DIR = process.env.LOG_DIR ?? join(__dirname, '../../../logs/worker')
const isDev = process.env.NODE_ENV !== 'production'

function rollTarget(filename: string, minLevel: string) {
  return {
    target: 'pino-roll',
    level: minLevel,
    options: {
      file: join(LOG_DIR, filename),
      frequency: 'daily',
      size: '20m',
      dateFormat: 'yyyy-MM-dd',
      mkdir: true,
    },
  }
}

let _logger: pino.Logger | null = null

/**
 * Worker 主 logger 单例：所有模块共享同一个实例，避免多个 pino-roll 写入流冲突
 */
export function buildLogger(): pino.Logger {
  if (_logger) return _logger

  const targets: pino.TransportTargetOptions[] = [
    rollTarget('error.log', 'error'),
    rollTarget('warn.log', 'warn'),
    rollTarget('info.log', 'info'),
  ]

  if (isDev) {
    targets.push({ target: 'pino-pretty', level: 'debug', options: { colorize: true } })
  }

  _logger = pino({
    level: process.env.LOG_LEVEL ?? 'info',
    transport: { targets },
  })

  return _logger
}
