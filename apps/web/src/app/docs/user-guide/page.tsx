import { DocsFigure, DocsNote, DocsPage, DocsSteps } from '@/components/docs/docs-page'

export default function UserGuidePage() {
  return (
    <DocsPage
      title="快速上手"
      lead="用 5 个步骤了解从进入平台到生成、查看、复用作品的完整创作路径。"
    >
      <DocsFigure
        src="/docs-images/user-guide-login-link.png"
        alt="登录页上的 AIGC 用户使用手册入口"
        caption="登录页底部提供低调的手册入口；登录后也可以从左侧菜单进入操作手册。"
      />

      <h2>5 步完成第一次创作</h2>
      <DocsSteps>
        <li>
          <strong>进入灵感首页。</strong>
          登录后先浏览首页的推荐内容和三类主入口，决定要做图片、视频还是画布项目。
        </li>
        <li>
          <strong>选择创作模块。</strong>
          点击 <a href="/docs/image-generation">AI 生图</a>、<a href="/docs/video-generation">AI 视频</a>、
          <a href="/docs/canvas">灵动画布</a> 或 <a href="/docs/toby-studio">Toby Studio</a>。
        </li>
        <li>
          <strong>填写提示词并上传参考素材。</strong>
          描述主体、风格、动作、构图和用途；需要保持风格或画面时上传参考图。
        </li>
        <li>
          <strong>提交生成任务。</strong>
          图片通常更快，视频和专项项目耗时更长；提交后可以切换到其它页面继续工作。
        </li>
        <li>
          <strong>查看、下载和复用。</strong>
          生成结果会进入历史和 <a href="/docs/assets">资产库</a>，可以下载成品，也可以复用参数继续微调。
        </li>
      </DocsSteps>

      <h2>不同入口怎么选</h2>
      <table>
        <thead>
          <tr>
            <th>想做什么</th>
            <th>推荐入口</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>快速得到一张图片</td>
            <td><a href="/docs/image-generation">AI 生图</a></td>
          </tr>
          <tr>
            <td>让图片或描述动起来</td>
            <td><a href="/docs/video-generation">AI 视频</a></td>
          </tr>
          <tr>
            <td>把素材和多个生成步骤串起来</td>
            <td><a href="/docs/canvas">灵动画布</a></td>
          </tr>
          <tr>
            <td>做音乐、短剧、绘本</td>
            <td><a href="/docs/toby-studio">Toby Studio</a></td>
          </tr>
          <tr>
            <td>找回以前生成过的作品</td>
            <td><a href="/docs/assets">资产库与历史复用</a></td>
          </tr>
        </tbody>
      </table>

      <DocsNote>
        <p>如果页面提示可用额度不足或没有可用工作区，请联系团队负责人处理；本手册不展开非创作配置。</p>
      </DocsNote>
    </DocsPage>
  )
}
