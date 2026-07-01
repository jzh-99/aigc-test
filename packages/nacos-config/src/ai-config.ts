// ai-config.ts
//
// AI 相关运行时配置的 getter 门面对象。
//
// 为什么用 getter 而不是 export const？
// ---------------------------------------------------------------
// ESM 的 export const 在模块加载时静态求值【一次】，此后即使把新值写进
// process.env，已 import 这个 const 的代码拿到的仍是旧值——热更不生效。
// （这是 JS 引擎层面的静态绑定，无法绕过。）
//
// getter 门面对象每次访问属性都实时读 process.env 当前值；Nacos 监听器把
// 远程配置刷进 process.env 后，下一次访问 getter 即拿到新值 → 热更生效。
//
// 使用约定：
//   - 顶层 const 读 env 的旧代码，改为读 aiConfig.xxx（或局部封装成 getter）。
//   - 已经在函数内直接读 process.env 的代码，无需改（天然热更）。
//
// 方案 B 约定：AI 供应商运行时配置只允许来自 Nacos。loadNacosConfig() 会在拉取
// Nacos 前清理这些 env，随后由 Nacos 写回；getter 不再提供内置默认值，避免 .env
// 或代码默认值悄悄兜底。

export const AI_CONFIG_ENV_KEYS = [
  'AI_CHAT_PROVIDER',
  'DOUBAO_API_URL',
  'DOUBAO_API_KEY',
  'DOUBAO_MODEL',
  'DOUBAO_NEWS_MODEL',
  'DOUBAO_TEXT_MODEL',
  'DOUBAO_STORYBOOK_POLISH_MODEL',
  'DOUBAO_STORYBOOK_IMAGE_MODEL',
  'VOLCENGINE_API_URL',
  'VOLCENGINE_API_KEY',
  'VOLCENGINE_ACCESS_KEY',
  'VOLCENGINE_SECRET_KEY',
  'CTYUN_EDGE_API_BASE_URL',
  'CTYUN_EDGE_API_KEY',
  'TOKENBUS_API_BASE_URL',
  'TOKENBUS_API_KEY',
  'NANO_BANANA_API_URL',
  'NANO_BANANA_API_KEY',
  'NANO_BANANA_MODEL',
  'QWEN_API_URL',
  'QWEN_API_KEY',
  'QWEN_MODEL',
  'MINIMAX_API_KEY',
  'MINIMAX_GROUP_ID',
  'MINIMAX_TTS_TIMEOUT_MS',
  'MUREKA_API_URL',
  'MUREKA_API_KEY',
  'PODCAST_WS_URL',
  'PODCAST_APP_ID',
  'PODCAST_ACCESS_KEY',
  'PODCAST_RESOURCE_ID',
  'PODCAST_APP_KEY',
  'PODCAST_TIMEOUT_SECONDS',
  // ── 系统级参数（跨供应商，集中放 system.properties）──
  'IMAGE_ADAPTER_TIMEOUT_MS',
  'VOLCENGINE_IMAGE_TIMEOUT_MS',
  'TOKENBUS_IMAGE_TIMEOUT_MS',
  'CTYUN_EDGE_IMAGE_TIMEOUT_MS',
  'IMAGE_GUARDIAN_TIMEOUT_MS',
  'VIDEO_POLL_CONCURRENCY',
  'VIDEO_POLL_REQUEST_TIMEOUT_MS',
  'MAX_VIDEO_AGE_MS',
  'NEWS_GENERATE_TIMEOUT_MS',
  'GROUP_IMAGE_TIMEOUT_MS',
  'POLISH_TIMEOUT_MS',
  'AI_ASSISTANT_MAX_TOKENS',
  'CANVAS_AGENT_CHAT_MAX_TOKENS',
  'CANVAS_AGENT_SCRIPT_MAX_TOKENS',
  'CANVAS_AGENT_STORYBOARD_MAX_TOKENS',
  'CANVAS_AGENT_TEXT_GEN_MAX_TOKENS',
  'SHORT_DRAMA_MAX_TOKENS',
] as const

// 启动期不做全量 key 必填校验：
// - 方案 B 要求"AI 配置只能来自 Nacos"，因此 loadNacosConfig 会先清理本地 env，
//   并强制所有 dataId 都能从 Nacos 拉取成功。
// - 但不同进程/队列不一定会使用所有供应商，例如未启用播客时 PODCAST_* 可以为空；
//   若在启动期把所有 key 都设为必填，会导致无关能力阻断 worker/api 启动。
// - 具体业务调用时仍由 adapter/service 校验自己真正需要的 key，并给出精确错误。
export const REQUIRED_AI_CONFIG_ENV_KEYS: readonly typeof AI_CONFIG_ENV_KEYS[number][] = []

function env(key: typeof AI_CONFIG_ENV_KEYS[number]): string {
  return process.env[key] ?? ''
}

function envNumber(key: typeof AI_CONFIG_ENV_KEYS[number]): number {
  const raw = env(key)
  return raw ? Number(raw) : 0
}

/**
 * 读数字型 env，未配置或非正数时返回 fallback 默认值。
 *
 * 仅供【系统级参数】（超时/并发/max_tokens）使用——这些是运维调参，不是供应商密钥，
 * 必须有合理默认（否则返回 0 会立即超时/拒绝请求），与供应商密钥的「严格无默认」策略不同。
 */
function envNumberOr(key: typeof AI_CONFIG_ENV_KEYS[number], fallback: number): number {
  const raw = env(key)
  const n = raw ? Number(raw) : NaN
  return Number.isFinite(n) && n > 0 ? n : fallback
}

/** 豆包 / 火山方舟 Ark（文本对话、绘本润色等） */
export const doubaoConfig = {
  /** 通过 AI_CHAT_PROVIDER 切换对话供应商：doubao | nano_banana */
  get chatProvider() {
    return env('AI_CHAT_PROVIDER')
  },
  get apiUrl() {
    return env('DOUBAO_API_URL')
  },
  get apiKey() {
    return env('DOUBAO_API_KEY')
  },
  get model() {
    return env('DOUBAO_MODEL')
  },
  get newsModel() {
    return env('DOUBAO_NEWS_MODEL')
  },
  get textModel() {
    return env('DOUBAO_TEXT_MODEL')
  },
  get storybookPolishModel() {
    return env('DOUBAO_STORYBOOK_POLISH_MODEL')
  },
  get storybookImageModel() {
    return env('DOUBAO_STORYBOOK_IMAGE_MODEL')
  },
}

/** 火山引擎（图片 Seedream / 视频 Seedance，Ark API Key；以及 Visual 数字人的 AK/SK 签名） */
export const volcengineConfig = {
  get apiUrl() {
    return env('VOLCENGINE_API_URL')
  },
  get apiKey() {
    return env('VOLCENGINE_API_KEY')
  },
  get accessKey() {
    return env('VOLCENGINE_ACCESS_KEY')
  },
  get secretKey() {
    return env('VOLCENGINE_SECRET_KEY')
  },
}

/** 天翼云边缘 AI 网关（图片/视频） */
export const ctyunEdgeConfig = {
  get apiBaseUrl() {
    return env('CTYUN_EDGE_API_BASE_URL')
  },
  get apiKey() {
    return env('CTYUN_EDGE_API_KEY')
  },
}

/** 算力巴士 Tokenbus（Tokenbus 图片生成） */
export const tokenbusConfig = {
  get apiBaseUrl() {
    return env('TOKENBUS_API_BASE_URL')
  },
  get apiKey() {
    return env('TOKENBUS_API_KEY')
  },
}

/** Nano Banana（Gemini / OpenAI 兼容通道，用于非图片生成链路） */
export const nanoBananaConfig = {
  get apiUrl() {
    return env('NANO_BANANA_API_URL')
  },
  get apiKey() {
    return env('NANO_BANANA_API_KEY')
  },
  get model() {
    return env('NANO_BANANA_MODEL')
  },
}

/** 通义千问 Qwen（分镜、文本生成） */
export const qwenConfig = {
  get apiUrl() {
    return env('QWEN_API_URL')
  },
  get apiKey() {
    return env('QWEN_API_KEY')
  },
  get model() {
    return env('QWEN_MODEL')
  },
}

/** MiniMax（TTS） */
export const minimaxConfig = {
  get apiKey() {
    return env('MINIMAX_API_KEY')
  },
  get groupId() {
    return env('MINIMAX_GROUP_ID')
  },
  /** TTS 超时（毫秒），必须由 Nacos 配置。 */
  get ttsTimeoutMs() {
    return envNumber('MINIMAX_TTS_TIMEOUT_MS')
  },
}

/** Mureka（音乐生成） */
export const murekaConfig = {
  get apiUrl() {
    return env('MUREKA_API_URL')
  },
  get apiKey() {
    return env('MUREKA_API_KEY')
  },
}

/** 字节播客 TTS（sami WebSocket） */
export const podcastConfig = {
  get wsUrl() {
    return env('PODCAST_WS_URL')
  },
  get appId() {
    return env('PODCAST_APP_ID')
  },
  get accessKey() {
    return env('PODCAST_ACCESS_KEY')
  },
  get resourceId() {
    return env('PODCAST_RESOURCE_ID')
  },
  get appKey() {
    return env('PODCAST_APP_KEY')
  },
  /** 超时（秒），必须由 Nacos 配置。 */
  get timeoutSeconds() {
    return envNumber('PODCAST_TIMEOUT_SECONDS')
  },
}

/**
 * 系统级参数（跨供应商，集中放 Nacos 的 system.properties）。
 *
 * 与供应商密钥（volcengineConfig 等）的区别：
 *   - 供应商密钥严格：无默认值，强制由 Nacos 提供（loadNacosConfig 会清理本地 env）
 *   - 系统级参数宽容：有合理默认值（对齐原硬编码），Nacos 可覆盖，未配时用默认保证不破坏现有行为
 *
 * 这些是运维调参（超时/并发/max_tokens），热更价值在于线上调优免重启。
 * 默认值与原硬编码一致（只迁不动值）。
 */
export const systemConfig = {
  // ── 图片生成超时链（adapter 调用 → 总兜底 → guardian 卡死判定，三者需联动）──
  /** Volcengine 图片单次请求超时（ms）。原硬编码 300_000。 */
  get volcengineImageTimeoutMs() {
    return envNumberOr('VOLCENGINE_IMAGE_TIMEOUT_MS', 300_000)
  },
  /** Tokenbus 图片单次请求超时（ms）。原硬编码 330_000。 */
  get tokenbusImageTimeoutMs() {
    return envNumberOr('TOKENBUS_IMAGE_TIMEOUT_MS', 330_000)
  },
  /** 天翼云图片单次请求超时（ms）。原硬编码 330_000。 */
  get ctyunEdgeImageTimeoutMs() {
    return envNumberOr('CTYUN_EDGE_IMAGE_TIMEOUT_MS', 330_000)
  },
  /** 图片任务总兜底超时（ms，worker index 调用 adapter 时的 withTimeout）。原硬编码 330_000。 */
  get imageAdapterTimeoutMs() {
    return envNumberOr('IMAGE_ADAPTER_TIMEOUT_MS', 330_000)
  },
  /** timeout-guardian 判定图片任务卡死的阈值（ms，须 > imageAdapterTimeoutMs）。原硬编码 360_000。 */
  get imageGuardianTimeoutMs() {
    return envNumberOr('IMAGE_GUARDIAN_TIMEOUT_MS', 360_000)
  },

  // ── 视频链路 ──
  /** 视频轮询并发数。原硬编码 10。 */
  get videoPollConcurrency() {
    return envNumberOr('VIDEO_POLL_CONCURRENCY', 10)
  },
  /** 视频单次轮询请求超时（ms）。原硬编码 30_000。 */
  get videoPollRequestTimeoutMs() {
    return envNumberOr('VIDEO_POLL_REQUEST_TIMEOUT_MS', 30_000)
  },
  /** 视频任务最大寿命（ms，超此判定为僵尸任务）。原硬编码 3_600_000（1 小时）。 */
  get maxVideoAgeMs() {
    return envNumberOr('MAX_VIDEO_AGE_MS', 3_600_000)
  },

  // ── 资讯 / 绘本超时 ──
  /** 资讯生成超时（ms，Ark /responses 长尾任务）。原硬编码 900_000（15 分钟）。 */
  get newsGenerateTimeoutMs() {
    return envNumberOr('NEWS_GENERATE_TIMEOUT_MS', 900_000)
  },
  /** 绘本组图超时（ms，seedream 组图耗时长）。原硬编码 600_000（10 分钟）。 */
  get groupImageTimeoutMs() {
    return envNumberOr('GROUP_IMAGE_TIMEOUT_MS', 600_000)
  },
  /** 绘本分镜润色超时（ms，Ark chat/completions）。原硬编码 300_000（5 分钟）。 */
  get polishTimeoutMs() {
    return envNumberOr('POLISH_TIMEOUT_MS', 300_000)
  },

  // ── 文本生成的 max_tokens（各业务场景独立配置）──
  /** AI 助手对话 max_tokens。原硬编码 4000。 */
  get aiAssistantMaxTokens() {
    return envNumberOr('AI_ASSISTANT_MAX_TOKENS', 4000)
  },
  /** 画布 agent 对话 max_tokens。原硬编码 8000。 */
  get canvasAgentChatMaxTokens() {
    return envNumberOr('CANVAS_AGENT_CHAT_MAX_TOKENS', 8000)
  },
  /** 画布 agent 剧本生成 max_tokens。原硬编码 4000。 */
  get canvasAgentScriptMaxTokens() {
    return envNumberOr('CANVAS_AGENT_SCRIPT_MAX_TOKENS', 4000)
  },
  /** 画布 agent 分镜拆分 max_tokens。原硬编码 16000。 */
  get canvasAgentStoryboardMaxTokens() {
    return envNumberOr('CANVAS_AGENT_STORYBOARD_MAX_TOKENS', 16_000)
  },
  /** 画布 agent 文本节点生成 max_tokens。原硬编码 2000。 */
  get canvasAgentTextGenMaxTokens() {
    return envNumberOr('CANVAS_AGENT_TEXT_GEN_MAX_TOKENS', 2000)
  },
  /** 短剧文本生成 max_tokens。原硬编码 4000。 */
  get shortDramaMaxTokens() {
    return envNumberOr('SHORT_DRAMA_MAX_TOKENS', 4000)
  },
}
