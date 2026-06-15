import { DocsFigure, DocsNote, DocsPage } from '@/components/docs/docs-page'

export default function ShortDramaDocsPage() {
  return (
    <DocsPage
      title="AI 短剧"
      lead="AI 短剧面向短剧项目，从故事设定逐步推进到剧集、剧本、分镜和视频化内容。"
    >
      <DocsFigure
        src="/docs-images/user-guide-current-short-drama.png"
        alt="AI 短剧页面"
        caption="AI 短剧以项目为单位组织内容，可创建新项目或继续编辑已有项目。"
      />

      <h2>适合场景</h2>
      <ul>
        <li>把一个故事创意拆成可持续创作的短剧项目。</li>
        <li>围绕分集、剧本和分镜逐步完善内容。</li>
        <li>需要保存项目并多次回来继续编辑。</li>
      </ul>

      <h2>基本流程</h2>
      <ol>
        <li>从 Toby Studio 进入 AI 短剧。</li>
        <li>创建或打开短剧项目。</li>
        <li>完善故事设定和分集方向。</li>
        <li>继续推进剧本、分镜和视频相关阶段。</li>
        <li>保存项目，后续从项目列表继续编辑。</li>
      </ol>

      <DocsNote>
        <p>短剧模块会根据项目阶段逐步展开操作。手册只描述当前能确认的创作路径，不虚构未开放按钮或参数。</p>
      </DocsNote>
    </DocsPage>
  )
}
