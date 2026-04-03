/**
 * 全局积分单价配置（后端）
 *
 * ⚠️  修改此文件时，请同步修改前端对应文件：
 *     apps/web/src/lib/credits.ts
 *
 * 完整的修改流程请参考：CREDIT_MODIFICATION_GUIDE.md
 */

// ─── 视频模型积分 ──────────────────────────────────────────────────────────
/**
 * 按秒计费的模型：每秒消耗的积分数
 * 总费用 = 时长(秒) × VIDEO_PER_SECOND_CREDITS[model]
 */
export const VIDEO_PER_SECOND_CREDITS: Record<string, number> = {
  'seedance-1.5-pro':  5,
  'seedance-2.0':      5,
  'seedance-2.0-fast': 5,
}

/**
 * 按次计费的模型：每次生成的积分数（flat rate）
 */
export const VIDEO_FLAT_CREDITS: Record<string, number> = {
  'veo3.1-fast':       10,
  'veo3.1-components': 15,
}

/**
 * 合并映射（向后兼容 VIDEO_CREDITS_MAP 用法）：
 * - 对于按秒计费模型，值表示每秒积分
 * - 对于按次计费模型，值表示每次积分
 */
export const VIDEO_CREDITS_MAP: Record<string, number> = {
  ...VIDEO_FLAT_CREDITS,
  ...VIDEO_PER_SECOND_CREDITS,
}
