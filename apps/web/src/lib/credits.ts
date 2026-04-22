/**
 * 全局积分单价配置（前端）
 *
 * ⚠️  修改此文件时，请同步修改后端对应文件：
 *     apps/api/src/lib/credits.ts
 *
 * 完整的修改流程请参考：CREDIT_MODIFICATION_GUIDE.md
 */

// ─── 图片模型积分（每张）───────────────────────────────────────────────────
export const IMAGE_MODEL_CREDITS: Record<
  'gemini' | 'gpt-image-2' | 'nano-banana-pro' | 'seedream-5.0-lite' | 'seedream-4.5' | 'seedream-4.0',
  number
> = {
  'gemini':            5,
  'gpt-image-2':       5,
  'nano-banana-pro':  10,
  'seedream-5.0-lite': 10,
  'seedream-4.5':     10,
  'seedream-4.0':     10,
}

// ─── 视频模型积分 ──────────────────────────────────────────────────────────
/**
 * 按秒计费的模型：每秒消耗的积分数
 * 总费用 = 时长(秒) × PER_SECOND_CREDITS[model]
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
