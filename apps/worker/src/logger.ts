import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pino from 'pino'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
// 默认落到 monorepo 根目录的 logs/worker/，可通过 LOG_DIR 覆盖
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

/**
 * Worker 主 logger：error / warn / info 分文件，开发环境额外输出 pino-pretty 到终端
 */
export function buildLogger(): pino.Logger {
  const targets: pino.TransportTargetOptions[] = [
    rollTarget('error.log', 'error'),
    rollTarget('warn.log', 'warn'),
    rollTarget('info.log', 'info'),
  ]

  if (isDev) {
    targets.push({ target: 'pino-pretty', level: 'debug', options: { colorize: true } })
  }

  return pino({
    level: process.env.LOG_LEVEL ?? 'info',
    transport: { targets },
  })
}
