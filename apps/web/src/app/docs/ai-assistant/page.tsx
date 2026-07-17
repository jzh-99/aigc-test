import { DocsFigure, DocsNote, DocsPage } from '@/components/docs/docs-page'

export default function AiAssistantDocsPage() {
  return (
    <DocsPage
      title="Toby.AI 创作助手"
      lead="右下角的常驻助手可以帮你优化提示词、策划内容、解析图片，并把想法整理成更可用的创作描述。"
    >
      <DocsFigure
        src="/docs-images/user-guide-current-ai-assistant2.png"
        alt="Toby.AI 创作助手面板"
        caption="点击右下角助手按钮后，可以在侧边面板里对话、上传参考图，并整理成可继续生成的提示词。"
      />

      <h2>常用能力</h2>
      <table>
        <thead>
          <tr>
            <th>能力</th>
            <th>适合怎么用</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>对话助手</td>
            <td>描述创意方向，让助手补充画面细节、风格词和镜头语言。</td>
          </tr>
          <tr>
            <td>提示词优化</td>
            <td>把口语化描述整理成更适合 AI 生图或视频生成的提示词。</td>
          </tr>
          <tr>
            <td>图片解析</td>
            <td>上传参考图，提取画面元素、风格、构图和可复用描述。</td>
          </tr>
          <tr>
            <td>创意策划</td>
            <td>让助手帮助规划短片主题、分镜方向或系列图片风格。</td>
          </tr>
        </tbody>
      </table>

      <h2>推荐用法</h2>
      <ol>
        <li>先写出你的粗略想法，不需要一开始就很专业。</li>
        <li>让助手补充主体、风格、构图、光线、动作和用途。</li>
        <li>把结果复制到 AI 生图、AI 视频或专项工作室中继续生成。</li>
        <li>如果结果不满意，把生成结果或问题再反馈给助手继续修改。</li>
      </ol>

      <DocsNote>
        <p>助手输出是创作建议，不会自动替你确认生成内容。提交任务前请检查提示词是否符合你的目标。</p>
      </DocsNote>
    </DocsPage>
  )
}
