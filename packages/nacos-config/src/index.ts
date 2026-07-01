// index.ts
//
// @aigc/nacos-config 包入口。
//
// 暴露三类内容：
// 1. loadNacosConfig() — 进程启动时调一次的编排函数（api/worker 入口接入点）
// 2. createNacosConfigSource() — 创建客户端（供高级用法/测试注入）
// 3. *Config getter 门面 — 业务代码读 AI 配置的统一入口（热更核心）
//
// 启动时序（api/worker 入口已先加载 dotenv，再调用本函数）：
//   loadNacosConfig() 先清理 AI 相关 env → 从 Nacos 拉取并写回 process.env。
//
// 方案 B 约定：Nacos 是 AI 供应商配置唯一来源。Nacos 未配置、连接失败、dataId
// 拉取失败均直接抛错阻止启动，避免进程混用 .env 旧值或代码默认值。
// 具体供应商 key 是否必填，由使用该供应商的 adapter/service 在调用时校验。

import { applyConfig, type ConfigSource, type ApplyConfigOptions, type DiffRecord } from './apply-config.js'
import { createNacosConfigSource } from './client.js'
import { AI_CONFIG_ENV_KEYS, REQUIRED_AI_CONFIG_ENV_KEYS } from './ai-config.js'

export { parseProperties, type ConfigSource, type ApplyConfigOptions, type DiffRecord } from './apply-config.js'
export { createNacosConfigSource, type NacosClientOptions } from './client.js'
export {
  doubaoConfig,
  volcengineConfig,
  ctyunEdgeConfig,
  tokenbusConfig,
  nanoBananaConfig,
  qwenConfig,
  minimaxConfig,
  murekaConfig,
  podcastConfig,
  systemConfig,
  AI_CONFIG_ENV_KEYS,
  REQUIRED_AI_CONFIG_ENV_KEYS,
} from './ai-config.js'

/** Nacos 配置分组：所有 AI 相关 dataId 归到同一组，便于权限统一管控。 */
export const AI_CONFIG_GROUP = 'AI_GROUP'

/**
 * 需要从 Nacos 拉取的 AI 配置 dataId 清单。
 *
 * 按提供商拆分而非一个大文件，原因：
 * 1. 权限隔离：可对不同 dataId 设置不同读写权限（如 doubao key 仅少数人可写）。
 * 2. 变更影响面可控：改一个提供商只推送那一个文件。
 * 3. 排查清晰：Nacos 控制台历史版本按 dataId 独立记录。
 *
 * 格式统一为 properties（KEY=VALUE）。
 *
 * ⚠️ dataId 命名约束：Nacos v1 OpenAPI 不允许 dataId 含 `/`（发布会报
 * "Param 'dataId' is illegal"），故用 `-` 连接，不能用路径风格。
 * example 配置文件见 deploy/nacos/example-configs/，文件名与本清单一一对应。
 */
export const AI_CONFIG_DATA_IDS: string[] = [
  'ai-providers-doubao.properties',
  'ai-providers-volcengine.properties',
  'ai-providers-ctyun.properties',
  'ai-providers-tokenbus.properties',
  'ai-providers-nano-banana.properties',
  'ai-providers-qwen.properties',
  'ai-providers-minimax.properties',
  'ai-providers-mureka.properties',
  'ai-providers-podcast.properties',
  'system.properties',
]

export interface LoadNacosConfigOptions {
  /**
   * 注入自定义 ConfigSource（主要用于测试）。
   * 不传时根据 process.env.NACOS_* 自动创建真实 Nacos 客户端。
   */
  source?: ConfigSource
  /** 透传给 applyConfig 的选项。测试时可用来改写 envSetter。 */
  applyOptions?: ApplyConfigOptions
  /** 是否校验必填 AI 配置项。生产默认开启；测试可关闭以聚焦编排行为。 */
  validateRequired?: boolean
  /** 是否在拉取 Nacos 前清理已有 AI env，默认开启，避免 .env 兜底。 */
  clearExistingAiEnv?: boolean
}

/** 内部日志：用 console，避免本包对具体 logger 实现产生依赖。 */
function log(level: 'info' | 'warn' | 'error', msg: string, extra?: unknown) {
  const fn = level === 'info' ? console.log : level === 'warn' ? console.warn : console.error
  if (extra !== undefined) {
    fn(`[nacos-config] ${msg}`, extra)
  } else {
    fn(`[nacos-config] ${msg}`)
  }
}

/**
 * 启动入口：拉取所有 AI 配置 dataId 并写入 process.env，注册热更订阅。
 *
 * 行为：
 * - 未配 NACOS_SERVER_ADDR → 抛错。
 * - 连接/拉取失败 → 抛错。
 * - 成功 → 所有 dataId 的配置已写入 process.env，订阅已注册。
 *
 * @returns 取消所有订阅的函数（进程关闭时可调，正常无需手动调）。
 */
export async function loadNacosConfig(opts: LoadNacosConfigOptions = {}): Promise<() => void> {
  const {
    source,
    applyOptions,
    validateRequired = true,
    clearExistingAiEnv = true,
  } = opts

  if (clearExistingAiEnv) {
    clearAiProviderEnv()
  }

  // 1. 获取配置源（测试注入 或 真实 Nacos）
  let configSource: ConfigSource
  if (source) {
    configSource = source
  } else {
    const serverAddr = process.env.NACOS_SERVER_ADDR
    if (!serverAddr) {
      throw new Error('NACOS_SERVER_ADDR is required: AI 供应商配置必须从 Nacos 加载')
    }
    try {
      configSource = await createNacosConfigSource({
        serverAddr,
        namespace: process.env.NACOS_NAMESPACE,
        username: process.env.NACOS_USERNAME,
        password: process.env.NACOS_PASSWORD,
      })
      log('info', `已连接 Nacos（namespace=${process.env.NACOS_NAMESPACE ?? 'public'}）`)
    } catch (err) {
      log('error', 'Nacos 连接失败，AI 配置无法加载', err)
      throw err
    }
  }

  // 2. 逐个 dataId 拉取 + 订阅。任一 dataId 失败都阻止启动，避免局部旧配置混用。
  //    同时收集启动初次的配置来源 diff，用于打印对照表。
  //    注意：要同时支持用户传入的 onDiff（测试/自定义诊断）和内部的 allDiffs 收集，
  //    所以合并两个回调，不能直接覆盖用户的 onDiff。
  const allDiffs: DiffRecord[] = []
  const userOnDiff = applyOptions?.onDiff
  const mergedOnDiff = (records: DiffRecord[]): void => {
    allDiffs.push(...records)
    if (userOnDiff) userOnDiff(records)
  }
  const unsubscribers: Array<() => void> = []
  for (const dataId of AI_CONFIG_DATA_IDS) {
    try {
      const unsub = await applyConfig(configSource, dataId, AI_CONFIG_GROUP, {
        ...applyOptions,
        onDiff: mergedOnDiff,
      })
      unsubscribers.push(unsub)
    } catch (err) {
      for (const unsub of unsubscribers) {
        unsub()
      }
      log('error', `拉取配置失败，停止启动：${dataId}`, err)
      throw err
    }
  }

  log('info', `配置加载完成（成功 ${unsubscribers.length}/${AI_CONFIG_DATA_IDS.length} 个 dataId）`)

  if (validateRequired) {
    validateRequiredAiConfig()
  }

  // 3. 打印配置来源对照表：每个值来自 Nacos 还是 .env，一眼看清。
  //    注意：SDK 的 subscribe 可能在 getConfig 后又立即推送一次初始值，
  //    导致同一 key 在 allDiffs 里出现多次（第二次的 before 已是 Nacos 值，会误判为"一致"）。
  //    所以按 key 去重，只保留【第一次】记录（第一次的 before 才是真正的 .env 原始值）。
  const seen = new Set<string>()
  const dedupedDiffs = allDiffs.filter((d) => {
    if (seen.has(d.key)) return false
    seen.add(d.key)
    return true
  })
  log('info', `已从 Nacos 获取 ${dedupedDiffs.length} 项 AI 配置`)
  if (process.env.NACOS_CONFIG_DEBUG === '1') {
    printConfigSourceTable(dedupedDiffs)
  }

  return () => {
    for (const unsub of unsubscribers) {
      unsub()
    }
  }
}

function clearAiProviderEnv(): void {
  for (const key of AI_CONFIG_ENV_KEYS) {
    delete process.env[key]
  }
}

function validateRequiredAiConfig(): void {
  const missing = REQUIRED_AI_CONFIG_ENV_KEYS.filter((key) => {
    const value = process.env[key]
    return value === undefined || value.trim() === ''
  })
  if (missing.length > 0) {
    throw new Error(`Nacos AI 配置缺少必填项：${missing.join(', ')}`)
  }
}

/**
 * 打印配置来源对照表。判断逻辑（基于 applyConfig 传回的 before/after）：
 * - before === undefined → 启动前无值，值【仅 Nacos 提供】
 * - before !== after      → Nacos【覆盖】了启动前残留值（实际生效的是 Nacos）
 * - before === after      → 启动前值与 Nacos【一致】
 * 敏感 key（含 KEY/SECRET/PASSWORD/TOKEN）的值打码，只显示首尾各 4 字符。
 */
function printConfigSourceTable(diffs: DiffRecord[]): void {
  if (diffs.length === 0) return

  type Row = { key: string; source: string; value: string }
  const rows: Row[] = diffs.map(({ key, before, after }) => {
    let source: string
    if (before === undefined) source = '仅Nacos' // .env 没配，值只来自 Nacos
    else if (before !== after) source = 'Nacos覆盖' // Nacos 覆盖了 .env
    else source = '一致' // 两边相同
    return { key, source, value: maskSecret(key, after) }
  })

  // 对齐列宽，便于阅读
  const keyWidth = Math.max(3, ...rows.map((r) => r.key.length))
  const srcWidth = Math.max(2, ...rows.map((r) => r.source.length))

  console.log(`[nacos-config] 配置来源对照（共 ${rows.length} 项）：`)
  console.log(
    `[nacos-config]   ${'KEY'.padEnd(keyWidth)}  ${'来源'.padEnd(srcWidth)}  值`,
  )
  for (const r of rows) {
    console.log(`[nacos-config]   ${r.key.padEnd(keyWidth)}  ${r.source.padEnd(srcWidth)}  ${r.value}`)
  }
  console.log(`[nacos-config]   说明：AI 配置只认 Nacos；启动前残留值仅用于诊断，不作为兜底。`)
}

/**
 * 敏感值打码：仅当 key 名以 _KEY/_SECRET/_PASSWORD/_TOKEN 结尾时（真正的凭证类变量），
 * 值才打码（首尾各 4 字符，中间 ****）。
 *
 * 注意：不能用 KEY|TOKEN 这种子串匹配——会把 TOKENBUS_IMAGE_TIMEOUT_MS、
 * CANVAS_AGENT_*_MAX_TOKENS 等含 TOKEN/KEY 子串的【数字型配置】误打码。
 * 空值原样显示（便于看出哪个必填项还没配）。
 */
function maskSecret(key: string, value: string): string {
  if (!value) return '(空)'
  // 仅凭证类（以 _KEY/_SECRET/_PASSWORD/_TOKEN 结尾）才打码
  if (!/(?:_KEY|_SECRET|_PASSWORD|_TOKEN)$/.test(key)) return value
  if (value.length <= 8) return '****'
  return `${value.slice(0, 4)}****${value.slice(-4)}`
}
