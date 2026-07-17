import { DocsFigure, DocsNote, DocsPage, DocsSteps } from '@/components/docs/docs-page'

export default function VideoGenerationDocsPage() {
  return (
    <DocsPage
      title="AI 视频"
      lead="用文字、首尾帧或参考图生成视频片段，适合动态海报、产品展示和短片镜头。"
    >
      <DocsFigure
        src="/docs-images/user-guide-current-generation-video.png"
        alt="AI 视频入口"
        caption="视频生成页包含模式选择、素材上传、提示词和参数设置。"
      />

      <h2>创作方式</h2>
      <table>
        <thead>
          <tr>
            <th>方式</th>
            <th>说明</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>首尾帧</td>
            <td>上传首帧和可选尾帧，控制视频起止画面。</td>
          </tr>
          <tr>
            <td>参考图生视频</td>
            <td>上传参考图片，让视频保持相近主体或视觉风格。</td>
          </tr>
          <tr>
            <td>文字描述</td>
            <td>只写画面和动作描述，让 AI 自行生成画面。</td>
          </tr>
        </tbody>
      </table>

      <h2>操作步骤</h2>
      <DocsSteps>
        <li>选择视频生成模式。</li>
        <li>上传首帧、尾帧或参考图；不需要参考素材时可只写文字描述。</li>
        <li>描述动作、镜头运动、速度、氛围和画面变化。</li>
        <li>设置比例、分辨率等参数。</li>
        <li>提交后等待完成，再从历史或资产库预览、下载和复用。</li>
      </DocsSteps>

      <h2>动作描述怎么写</h2>
      <ul>
        <li>写主体动作：人物转身、产品旋转、镜头穿过场景。</li>
        <li>写镜头运动：缓慢推进、横移、环绕、拉远。</li>
        <li>写变化过程：从白天到夜晚、从静止到漂浮、从模糊到清晰。</li>
      </ul>

      <DocsNote>
        <p>视频任务通常比图片更久。提交后可以离开页面，完成结果会保存在历史和资产库中。</p>
      </DocsNote>
    </DocsPage>
  )
}
