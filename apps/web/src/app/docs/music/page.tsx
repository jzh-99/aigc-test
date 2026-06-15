import { DocsFigure, DocsNote, DocsPage } from '@/components/docs/docs-page'

export default function MusicDocsPage() {
  return (
    <DocsPage
      title="AI 音乐"
      lead="AI 音乐用于创建歌曲和纯音乐，并管理我的音乐作品与克隆音色。"
    >
      <DocsFigure
        src="/docs-images/user-guide-current-music.png"
        alt="AI 音乐页面"
        caption="AI 音乐页面包含创建面板、音乐作品列表和音色克隆入口。"
      />

      <h2>页面区域</h2>
      <table>
        <thead>
          <tr>
            <th>区域</th>
            <th>用途</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>创建面板</td>
            <td>填写音乐主题、风格和生成参数，提交音乐生成任务。</td>
          </tr>
          <tr>
            <td>我的音乐作品</td>
            <td>浏览、搜索和分页查看已创建的音乐。</td>
          </tr>
          <tr>
            <td>音色克隆</td>
            <td>上传声音素材，等待克隆完成后用于音乐创作。</td>
          </tr>
        </tbody>
      </table>

      <h2>基本流程</h2>
      <ol>
        <li>从 Toby Studio 进入 AI 音乐。</li>
        <li>在创建面板填写音乐需求并提交。</li>
        <li>等待生成状态更新；完成后会出现在我的音乐作品中。</li>
        <li>点击作品封面进入详情页，播放音乐并查看歌词等信息。</li>
      </ol>

      <DocsNote>
        <p>音色克隆和音乐生成都需要等待后台处理。处理完成或失败时，页面会更新状态提示。</p>
      </DocsNote>
    </DocsPage>
  )
}
