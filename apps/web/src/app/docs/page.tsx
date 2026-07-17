import { DocsCard, DocsCards, DocsFigure, DocsNote, DocsPage } from '@/components/docs/docs-page'

export default function DocsHomePage() {
  return (
    <DocsPage
      title="AIGC 创作手册"
      lead="面向普通创作用户，按当前平台入口介绍 AI 生图、AI 视频、灵动画布、资产库和 Toby Studio。"
    >
      <DocsFigure
        src="/docs-images/user-guide-current-home.png"
        alt="平台首页创作入口"
        caption="登录后先看到灵感首页，可以从首页卡片或左侧导航进入各个创作模块。"
      />

      <h2>从当前首页理解平台</h2>
      <DocsCards>
        <DocsCard title="AI 生图" href="/docs/image-generation">
          <p>用文字描述或参考图生成图片，适合海报主视觉、产品图、场景图和灵感探索。</p>
        </DocsCard>
        <DocsCard title="AI 视频" href="/docs/video-generation">
          <p>用文字、首尾帧或参考图生成视频，适合动态海报、产品展示和短片镜头。</p>
        </DocsCard>
        <DocsCard title="灵动画布" href="/docs/canvas">
          <p>把素材、文本、图片、视频等节点串联起来，适合更长链路和多版本探索。</p>
        </DocsCard>
        <DocsCard title="资产库" href="/docs/assets">
          <p>集中查看生成结果，下载成品，或复用历史提示词和参数继续创作。</p>
        </DocsCard>
        <DocsCard title="Toby Studio" href="/docs/toby-studio">
          <p>进入音乐、短剧、绘本等专项工作室，用更固定的步骤完成内容项目。</p>
        </DocsCard>
        <DocsCard title="Toby.AI 创作助手" href="/docs/ai-assistant">
          <p>在右下角打开助手，优化提示词、策划内容、解析参考图并提炼创作描述。</p>
        </DocsCard>
      </DocsCards>

      <h2>推荐阅读顺序</h2>
      <ol>
        <li>先看 <a href="/docs/user-guide">快速上手</a>，了解从入口到结果的完整路径。</li>
        <li>根据任务选择 <a href="/docs/image-generation">AI 生图</a>、<a href="/docs/video-generation">AI 视频</a> 或 <a href="/docs/canvas">灵动画布</a>。</li>
        <li>生成完成后阅读 <a href="/docs/assets">资产库与历史复用</a>，学习下载、复用和继续迭代。</li>
        <li>需要音乐、短剧或绘本时，再进入 <a href="/docs/toby-studio">Toby Studio</a>。</li>
      </ol>

      <DocsNote>
        <p>这份手册只讲普通创作功能，不展开团队、账号、费用等非创作配置。</p>
      </DocsNote>
    </DocsPage>
  )
}
