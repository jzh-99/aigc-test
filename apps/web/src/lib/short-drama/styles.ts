import type { ShortDramaStyleTab } from '@aigc/types'

export interface ShortDramaStyleOption {
  id: string
  tab: ShortDramaStyleTab
  name: string
  description: string
  imageUrl?: string
  custom?: boolean
}

export const SHORT_DRAMA_STYLE_OPTIONS: ShortDramaStyleOption[] = [
  { id: 'custom', tab: '全部', name: '自定义风格', description: '输入你自己的视觉风格描述', custom: true },
  { id: 'real-city', tab: '真人', name: '真人都市', description: '适合都市情感、逆袭、创业题材' },
  { id: 'real-costume', tab: '真人', name: '真人古装', description: '适合古风权谋、仙侠、穿越题材' },
  { id: '2d-anime', tab: '2D', name: '2D 动漫', description: '适合轻小说、校园、奇幻题材' },
  { id: '2d-comic', tab: '2D', name: '国漫厚涂', description: '适合热血、玄幻、冒险题材' },
  { id: '3d-cinematic', tab: '3D', name: '3D 电影感', description: '适合科幻、悬疑、动作题材' },
  { id: '3d-clay', tab: '3D', name: '3D 黏土', description: '适合轻喜剧、治愈、合家欢题材' },
]

export function getShortDramaStylesByTab(tab: ShortDramaStyleTab): ShortDramaStyleOption[] {
  if (tab === '全部') return SHORT_DRAMA_STYLE_OPTIONS
  return SHORT_DRAMA_STYLE_OPTIONS.filter(option => option.tab === tab)
}
