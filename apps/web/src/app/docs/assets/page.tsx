import { DocsFigure, DocsNote, DocsPage } from '@/components/docs/docs-page'

export default function AssetsDocsPage() {
  return (
    <DocsPage
      title="资产库与历史复用"
      lead="资产库集中管理生成完成的图片和视频，也是一切二次创作的起点。"
    >
      <DocsFigure
        src="/docs-images/user-guide-current-assets.png"
        alt="资产库页面"
        caption="资产库支持图片和视频切换、日期筛选、预览、下载和复用。"
      />

      <h2>你可以做什么</h2>
      <table>
        <thead>
          <tr>
            <th>操作</th>
            <th>说明</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>筛选</td>
            <td>按图片、视频和日期快速找到历史结果。</td>
          </tr>
          <tr>
            <td>预览</td>
            <td>打开资产详情，查看原图、视频和生成信息。</td>
          </tr>
          <tr>
            <td>下载</td>
            <td>把成品保存到本地继续使用。</td>
          </tr>
          <tr>
            <td>复用</td>
            <td>把原提示词和参数带回创作面板，继续微调。</td>
          </tr>
          <tr>
            <td>删除</td>
            <td>不再使用的资产可移入回收站。</td>
          </tr>
        </tbody>
      </table>

      <DocsNote>
        <p>生成任务完成后会沉淀为可复用资产。找到满意风格后，优先复用再调整，比重新填写参数更高效。</p>
      </DocsNote>
    </DocsPage>
  )
}
