// apps/web/src/lib/model-images.ts

const MODEL_IMAGES: Record<string, string> = {
  'seedance-2.0': '/models/seedance-2.0.png',
  'seedance-2.0-fast': '/models/seedance-2.0-fast.png',
}

/**
 * 根据模型 code 获取对应的图片 URL
 * 无映射时返回 undefined，调用方应回退为默认图标
 */
export function getModelImage(code: string): string | undefined {
  return MODEL_IMAGES[code]
}