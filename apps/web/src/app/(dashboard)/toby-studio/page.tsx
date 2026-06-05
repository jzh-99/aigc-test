import Link from 'next/link'
import { BookOpenText, ImageIcon, Music2, Presentation, Sparkles, Video } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

const studioModules = [
  {
    title: 'AI 音乐',
    description: '生成歌曲、纯音乐，管理我的音乐作品与克隆音色。',
    href: '/toby-studio/music',
    icon: Music2,
    status: '已开放',
    available: true,
  },
  {
    title: 'AI 短剧',
    description: '面向短剧脚本、分镜与成片工作流的创作模块。',
    href: '/toby-studio/short-drama',
    icon: Video,
    status: '已开放',
    available: true,
  },
  {
    title: 'AI 绘本',
    description: '面向绘本故事、角色设定与连续画面生成的创作模块。',
    href: '/toby-studio/picture-book',
    icon: BookOpenText,
    status: '已开放',
    available: true,
  },
  {
    title: 'AI 海报',
    description: '面向品牌宣传、活动物料与营销视觉的海报创作模块。',
    href: '/toby-studio/poster',
    icon: ImageIcon,
    status: '待开放',
    available: false,
  },
  {
    title: 'AI PPT',
    description: '面向提纲生成、页面排版与演示文稿制作的创作模块。',
    href: '/toby-studio/ppt',
    icon: Presentation,
    status: '待开放',
    available: false,
  },
]

export default function TobyStudioPage() {
  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3">
        <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Sparkles className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-normal">Toby Studio</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            独立内容工作室，承载音乐、短剧、绘本等专项创作模块。
          </p>
        </div>
      </header>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {studioModules.map((item) => {
          const Icon = item.icon
          const content = (
            <div className="flex h-full flex-col rounded-lg border bg-card p-5 transition-colors hover:border-primary/60">
              <div className="flex items-start justify-between gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-muted">
                  <Icon className="h-5 w-5 text-foreground" />
                </div>
                <Badge variant={item.available ? 'default' : 'secondary'}>{item.status}</Badge>
              </div>
              <div className="mt-5 flex-1">
                <h2 className="text-lg font-semibold tracking-normal">{item.title}</h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{item.description}</p>
              </div>
              <Button className="mt-5 w-full" variant={item.available ? 'default' : 'outline'} disabled={!item.available}>
                {item.available ? '进入模块' : '待开放'}
              </Button>
            </div>
          )

          return item.available ? (
            <Link key={item.title} href={item.href} className="block h-full">
              {content}
            </Link>
          ) : (
            <div key={item.title} className="h-full">
              {content}
            </div>
          )
        })}
      </section>
    </div>
  )
}
