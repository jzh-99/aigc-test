// apply-config.ts
//
// 远程配置 → process.env 的写入与热更。
//
// 这是 Nacos 热更链路的【唯一写入点】：所有配置变更最终都通过修改 process.env 生效，
// 下游业务代码（ai-config.ts 的 getter 门面、或函数内直接读 process.env 的代码）
// 因此能拿到最新值，无需重启进程。
//
// 设计要点：本模块只依赖一个抽象接口 ConfigSource（getConfig + subscribe），
// 真实环境由 client.ts 注入 NacosConfigClient，测试环境注入手写 mock。
// 这样单元测试不需要连接真实 Nacos（参考仓库 dispatch-result.test.ts 的 DI 风格）。

/** 抽象的配置源：能拉取一次配置 + 能订阅变更。真实实现是 NacosConfigClient。 */
export interface ConfigSource {
  /** 拉取一次配置内容（properties 格式字符串），失败抛错。 */
  getConfig(dataId: string, group: string): Promise<string>
  /** 订阅配置变更，Nacos 推送时回调 listener(content)；返回一个取消订阅函数。 */
  subscribe(
    info: { dataId: string; group: string },
    listener: (content: string) => void,
  ): () => void
}

/**
 * 解析 properties 格式字符串为 [key, value] 列表。
 *
 * properties 格式约定（与 Nacos 控制台一致）：
 *   KEY=VALUE          每行一条
 *   # 注释             以 # 开头的行忽略
 *   空行               忽略
 *   行首尾空格         trim 掉
 *   等号两侧空格       trim 掉
 *   key 必须是 [A-Z_][A-Z0-9_]*   非法格式静默跳过（容错，避免一条坏配置导致整体失败）
 *
 * 导出供测试单独验证解析逻辑。
 */
export function parseProperties(content: string): Array<[string, string]> {
  const result: Array<[string, string]> = []
  if (!content) return result

  const lines = content.split(/\r?\n/)
  for (const rawLine of lines) {
    const line = rawLine.trim()
    // 空行与注释跳过
    if (!line || line.startsWith('#')) continue

    const eqIdx = line.indexOf('=')
    if (eqIdx === -1) continue

    const key = line.slice(0, eqIdx).trim()
    const value = line.slice(eqIdx + 1).trim()
    // key 必须是合法的环境变量名（大写字母/数字/下划线，且不以数字开头）
    if (!/^[A-Z_][A-Z0-9_]*$/.test(key)) continue

    result.push([key, value])
  }
  return result
}

export interface ApplyConfigOptions {
  /** 解析后是否写入 process.env。默认 true。测试时可关掉，只验证解析结果。 */
  applyToEnv?: boolean
  /** 把 [key,value] 写入 process.env 的函数，默认走真实 process.env，便于测试注入。 */
  envSetter?: (key: string, value: string) => void
  /**
   * 配置来源诊断回调：每次写入（启动初次 + 热更推送）都会回调，传回每个 key 的前后值。
   * 用于 loadNacosConfig 汇总打印「这个值是 Nacos 覆盖的、还是 .env 兜底的」。
   * before/after 为原始值（未打码），打码展示由调用方负责（避免本模块耦合展示逻辑）。
   */
  onDiff?: (records: DiffRecord[]) => void
}

/**
 * 单个配置项的来源对照：before=写入前(.env来源)，after=写入后(Nacos来源)。
 * - before === undefined → .env 未配此 key，值仅来自 Nacos
 * - before !== after → Nacos 覆盖了 .env 的值
 * - before === after → .env 与 Nacos 一致（未实质覆盖）
 */
export interface DiffRecord {
  key: string
  /** 写入前 process.env 的值（dotenv 加载的 .env 值）；undefined 表示 .env 未配。 */
  before: string | undefined
  /** 写入后的值（Nacos 下发的值）。 */
  after: string
}

/**
 * 拉取一个 dataId 的配置，解析后写入 process.env，并注册订阅以便后续热更。
 *
 * 调用时机：进程启动时，由 loadNacosConfig() 对每个 dataId 调一次。
 * 失败处理：getConfig 抛错时由调用方（loadNacosConfig）兜底，本函数内部不 catch。
 *
 * @returns 取消订阅函数（仅在进程关闭时调用，正常无需手动调用）。
 */
export async function applyConfig(
  source: ConfigSource,
  dataId: string,
  group: string,
  opts: ApplyConfigOptions = {},
): Promise<() => void> {
  const { applyToEnv = true, envSetter = defaultEnvSetter, onDiff } = opts

  const writeToEnv = (content: string): number => {
    const entries = parseProperties(content)
    if (!applyToEnv) return entries.length

    // 收集本次写入的 diff（写入前快照 .env 的旧值，写入后对比）
    const diffs: DiffRecord[] = []
    for (const [key, value] of entries) {
      const before = process.env[key] // 写入前的值（dotenv 已加载的 .env 来源）
      envSetter(key, value)
      diffs.push({ key, before, after: value })
    }
    if (onDiff && diffs.length > 0) {
      onDiff(diffs)
    }
    return entries.length
  }

  // 1. 先拉取一次，把当前值立即写入 env（不等第一次推送）
  const initial = await source.getConfig(dataId, group)
  writeToEnv(initial)

  // 2. 订阅变更：Nacos 推送时（控制台发布/回滚）重新解析并刷新 env
  const unsubscribe = source.subscribe({ dataId, group }, (newContent) => {
    writeToEnv(newContent)
  })

  return () => {
    try {
      unsubscribe()
    } catch {
      /* 取消订阅失败可忽略，进程通常即将退出 */
    }
  }
}

/** 默认 env 写入器：直接写 process.env。 */
function defaultEnvSetter(key: string, value: string): void {
  process.env[key] = value
}
