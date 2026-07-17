export const docsNavSections = [
  {
    label: '开始创作',
    items: [
      { href: '/docs', label: '创作手册首页' },
      { href: '/docs/user-guide', label: '快速上手' },
    ],
  },
  {
    label: '核心创作',
    items: [
      { href: '/docs/image-generation', label: 'AI 生图' },
      { href: '/docs/video-generation', label: 'AI 视频' },
      { href: '/docs/canvas', label: '灵动画布' },
      { href: '/docs/assets', label: '资产库与历史复用' },
      { href: '/docs/ai-assistant', label: 'Toby.AI 创作助手' },
    ],
  },
  {
    label: '专项工作室',
    items: [
      { href: '/docs/toby-studio', label: 'Toby Studio 总览' },
      { href: '/docs/music', label: 'AI 音乐' },
      { href: '/docs/short-drama', label: 'AI 短剧' },
      { href: '/docs/picture-book', label: 'AI 绘本' },
    ],
  },
] as const
