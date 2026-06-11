/** 通用 @ 提及资源 */
export interface MentionResource {
  id: string
  /** @标签显示文本，如 "图片1"、"角色A" */
  mentionLabel: string
  /** 选择器中的描述文字，如 "参考图"、"已生成图片" */
  sourceLabel?: string
  /** 资源种类，用于颜色/图标区分，如 "image"、"character" */
  kind: string
  /** 别名列表（可选），支持多个名称触发同一个 @ */
  aliases?: string[]
}
