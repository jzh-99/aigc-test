import { DocsCard, DocsCards, DocsFigure, DocsNote, DocsPage } from '@/components/docs/docs-page'

export default function TobyStudioDocsPage() {
  return (
    <DocsPage
      title="Toby Studio 总览"
      lead="Toby Studio 是专项内容工作室入口，承载音乐、短剧、绘本等更固定流程的创作模块。"
    >
      <DocsFigure
        src="/docs-images/user-guide-current-toby-studio.png"
        alt="Toby Studio 首页"
        caption="从左侧 Toby 入口进入专项工作室。"
      />

      <h2>已开放模块</h2>
      <DocsCards>
        <DocsCard title="AI 音乐" href="/docs/music">
          <p>生成歌曲、纯音乐，管理音乐作品，并使用音色克隆能力。</p>
        </DocsCard>
        <DocsCard title="AI 短剧" href="/docs/short-drama">
          <p>面向短剧脚本、分镜与成片链路，适合连续剧集内容。</p>
        </DocsCard>
        <DocsCard title="AI 绘本" href="/docs/picture-book">
          <p>面向绘本故事、角色设定与连续画面生成。</p>
        </DocsCard>
      </DocsCards>

      <h2>待开放模块</h2>
      <ul>
        <li>AI 海报：面向品牌宣传、活动物料与营销视觉。</li>
        <li>AI PPT：面向提纲生成、页面排版与演示文稿制作。</li>
      </ul>

      <DocsNote>
        <p>待开放模块只说明入口状态，不提供操作步骤。请以页面上的开放状态为准。</p>
      </DocsNote>
    </DocsPage>
  )
}
