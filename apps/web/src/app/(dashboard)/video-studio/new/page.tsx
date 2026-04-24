'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Film, Tv, ArrowLeft, ArrowRight } from 'lucide-react'
import Link from 'next/link'

type ProjectType = 'single' | 'series'

export default function NewVideoProjectPage() {
  const router = useRouter()
  const [type, setType] = useState<ProjectType | null>(null)
  const [name, setName] = useState('')
  const [episodeCount, setEpisodeCount] = useState(3)

  const handleCreate = () => {
    if (!type || !name.trim()) return
    // Encode project config in URL params — no backend persistence yet
    const params = new URLSearchParams({
      name: name.trim(),
      type,
      ...(type === 'series' ? { episodes: String(episodeCount) } : {}),
    })
    router.push(`/video-studio/wizard?${params.toString()}`)
  }

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-8">
      <div className="flex items-center gap-3">
        <Link href="/video-studio" className="text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="text-xl font-bold">新建视频项目</h1>
          <p className="text-sm text-muted-foreground">选择项目类型，开始你的创作</p>
        </div>
      </div>

      {/* Type selection */}
      <div className="grid grid-cols-2 gap-4">
        <button
          onClick={() => setType('single')}
          className={`p-5 border-2 rounded-2xl text-left space-y-3 transition-all ${
            type === 'single' ? 'border-primary bg-primary/5' : 'border-border hover:border-muted-foreground/40'
          }`}
        >
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${type === 'single' ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}>
            <Film className="w-5 h-5" />
          </div>
          <div>
            <p className="font-semibold">单集视频</p>
            <p className="text-xs text-muted-foreground mt-0.5">一个完整短片，直接进入制作流程</p>
          </div>
          <ul className="text-xs text-muted-foreground space-y-0.5">
            <li>· 适合广告、MV、短片</li>
            <li>· 15秒 ~ 5分钟</li>
            <li>· 5步完成</li>
          </ul>
        </button>

        <button
          onClick={() => setType('series')}
          className={`p-5 border-2 rounded-2xl text-left space-y-3 transition-all ${
            type === 'series' ? 'border-primary bg-primary/5' : 'border-border hover:border-muted-foreground/40'
          }`}
        >
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${type === 'series' ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}>
            <Tv className="w-5 h-5" />
          </div>
          <div>
            <p className="font-semibold">系列剧集</p>
            <p className="text-xs text-muted-foreground mt-0.5">多集故事，先写大纲再逐集制作</p>
          </div>
          <ul className="text-xs text-muted-foreground space-y-0.5">
            <li>· 适合连续剧、系列内容</li>
            <li>· 2 ~ 50 集</li>
            <li>· 先规划大纲，再逐集制作</li>
          </ul>
        </button>
      </div>

      {/* Project details */}
      {type && (
        <div className="space-y-4 p-5 border rounded-xl bg-card">
          <div>
            <label className="text-sm font-medium block mb-1.5">项目名称</label>
            <input
              type="text"
              className="w-full px-3 py-2 text-sm bg-muted/60 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary"
              placeholder={type === 'single' ? '例如：城市夜行者' : '例如：星际迷途 第一季'}
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>

          {type === 'series' && (
            <div>
              <label className="text-sm font-medium block mb-1.5">集数</label>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min={2}
                  max={20}
                  value={episodeCount}
                  onChange={(e) => setEpisodeCount(Number(e.target.value))}
                  className="flex-1 accent-primary"
                />
                <span className="text-sm font-medium w-12 text-right">{episodeCount} 集</span>
              </div>
            </div>
          )}
        </div>
      )}

      {type && (
        <button
          onClick={handleCreate}
          disabled={!name.trim()}
          className="flex items-center gap-2 bg-primary text-primary-foreground px-6 py-2.5 rounded-lg text-sm hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          开始创作
          <ArrowRight className="w-4 h-4" />
        </button>
      )}
    </div>
  )
}
