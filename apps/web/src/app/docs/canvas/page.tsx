import { DocsFigure, DocsNote, DocsPage } from '@/components/docs/docs-page'

export default function CanvasDocsPage() {
  return (
    <DocsPage
      title="灵动画布"
      lead="用节点方式组织素材、提示词和生成步骤，适合复杂创作链路和多版本探索。"
    >
      <DocsFigure
        src="/docs-images/user-guide-current-canvas.png"
        alt="灵动画布入口"
        caption="从首页灵动画布卡片或左侧“画布”入口进入。"
      />

      <h2>开始方式</h2>
      <table>
        <thead>
          <tr>
            <th>入口</th>
            <th>适合场景</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>制作视频</td>
            <td>从剧本、分镜、角色逐步推进到视频。</td>
          </tr>
          <tr>
            <td>生成图片</td>
            <td>围绕一组参考素材持续生成图片。</td>
          </tr>
          <tr>
            <td>自由创作</td>
            <td>从空白画布开始，按自己的思路搭建节点。</td>
          </tr>
        </tbody>
      </table>

      <h2>节点式创作思路</h2>
      <ul>
        <li>素材节点：放入参考图、已有图片或视频。</li>
        <li>文本节点：保存脚本、提示词、分镜描述。</li>
        <li>图片生成节点：根据文本和参考素材生成画面。</li>
        <li>视频生成节点：把关键画面转成动态镜头。</li>
        <li>音频和拼接节点：为视频链路补充声音和组合结果。</li>
      </ul>

      <DocsNote>
        <p>灵动画布适合保留上下游关系。需要快速生成单张图或单条视频时，直接使用“创作”入口更轻便。</p>
      </DocsNote>
    </DocsPage>
  )
}
