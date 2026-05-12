import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pino from 'pino'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
// 默认落到 monorepo 根目录的 logs/api/，可通过 LOG_DIR 覆盖
const LOG_DIR = process.env.LOG_DIR ?? join(__dirname, '../../../logs/api')
const isDev = process.env.NODE_ENV !== 'production'

function rollTarget(filename: string, minLevel: string) {
  return {
    target: 'pino-roll',
    level: minLevel,
    options: {
      file: join(LOG_DIR, filename),
      frequency: 'daily',     // 每天轮转一次
      size: '20m',            // 单文件超 20MB 也触发轮转
      dateFormat: 'yyyy-MM-dd',
      mkdir: true,
    },
  }
}

/**
 * 应用主 logger：error / warn / info 分文件，开发环境额外输出 pino-pretty 到终端
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

/**
 * Access logger：HTTP 请求日志单独写 access 文件，不混入应用日志
 */
export function buildAccessLogger(): pino.Logger {
  const targets: pino.TransportTargetOptions[] = [
    rollTarget('access.log', 'info'),
  ]

  if (isDev) {
    targets.push({ target: 'pino-pretty', level: 'info', options: { colorize: true } })
  }

  return pino({
    level: 'info',
    transport: { targets },
  })
}
