import { DocsFigure, DocsNote, DocsPage, DocsSteps } from '@/components/docs/docs-page'

export default function ImageGenerationDocsPage() {
  return (
    <DocsPage
      title="AI 生图"
      lead="用文字描述或参考图生成图片，适合主视觉、产品图、场景概念和灵感草图。"
    >
      <DocsFigure
        src="/docs-images/user-guide-current-generation-image.png"
        alt="AI 生图入口"
        caption="创作面板左侧填写提示词和参数，右侧查看本次生成历史。"
      />

      <h2>常用方式</h2>
      <table>
        <thead>
          <tr>
            <th>方式</th>
            <th>适合场景</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>文生图</td>
            <td>从文字创意直接生成新画面。</td>
          </tr>
          <tr>
            <td>参考图生图</td>
            <td>上传参考图，让结果保留相近风格、构图或视觉元素。</td>
          </tr>
        </tbody>
      </table>

      <h2>操作步骤</h2>
      <DocsSteps>
        <li>进入 AI 生图后，先选择是否上传参考图。</li>
        <li>在提示词中写清楚主体、风格、构图、光线、用途和希望避免的内容。</li>
        <li>设置模型、质量、比例和生成数量。</li>
        <li>点击生成，等待任务出现在右侧历史区域。</li>
        <li>打开结果详情，预览、下载，或复用提示词和参数继续微调。</li>
      </DocsSteps>

      <h2>提示词建议</h2>
      <ul>
        <li>主体：画面里最重要的人、物、场景。</li>
        <li>风格：写实、插画、国风、商业摄影、电影感等。</li>
        <li>构图：近景、全景、居中、俯拍、对称构图等。</li>
        <li>光线：自然光、逆光、柔光、霓虹、棚拍等。</li>
        <li>用途：海报、封面、商品图、分镜首帧等。</li>
      </ul>

      <DocsNote>
        <p>结果方向接近时，不要从零开始。优先使用“复用”把原参数带回面板，再小步调整提示词。</p>
      </DocsNote>
    </DocsPage>
  )
}
