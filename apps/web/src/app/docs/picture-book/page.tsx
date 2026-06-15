import { DocsFigure, DocsNote, DocsPage } from '@/components/docs/docs-page'

export default function PictureBookDocsPage() {
  return (
    <DocsPage
      title="AI 绘本"
      lead="AI 绘本面向故事、角色设定与连续画面生成，适合儿童绘本和分镜式图文内容。"
    >
      <DocsFigure
        src="/docs-images/user-guide-current-picture-book.png"
        alt="AI 绘本页面"
        caption="AI 绘本页面用于创建绘本项目，也可以从项目列表继续编辑未完成作品。"
      />

      <h2>适合场景</h2>
      <ul>
        <li>把故事想法整理成连续绘本项目。</li>
        <li>先设定角色，再围绕角色生成多页画面。</li>
        <li>需要保持画风和角色一致性的图文创作。</li>
      </ul>

      <h2>基本流程</h2>
      <ol>
        <li>从 Toby Studio 进入 AI 绘本。</li>
        <li>创建或打开绘本项目。</li>
        <li>完善故事方向、角色设定和画面风格。</li>
        <li>按页面或分镜推进连续画面生成。</li>
        <li>从项目列表继续编辑未完成作品。</li>
      </ol>

      <DocsNote>
        <p>绘本模块以项目为单位组织内容。若页面中某些能力暂未开放，请以页面状态为准。</p>
      </DocsNote>
    </DocsPage>
  )
}
