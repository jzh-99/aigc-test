# video_categories 能力限制设计

## 背景

`provider_models.video_categories` 目前只表达视频模型支持的生成模式，例如首尾帧和全能参考。现在需要在不改字段名的前提下，让它同时表达每种模式允许的参考素材数量，用于前端在调用生成接口之前限制用户操作，并由后端做兜底校验。

## 目标

- 字段名继续使用 `video_categories`。
- 不兼容旧数组结构，直接升级为对象结构，数据通过 `packages/db/scripts/seed.ts` 调整。
- 支持按模式限制图片、视频、音频参考数量。
- 创作生成页和画布视频节点在提交前完成操作限制。
- 后端 `/videos/generate` 按同一规则兜底校验，防止绕过前端。

## 非目标

- 不新增数据库字段。
- 不保留 `['frames']`、`['multimodal']` 等旧数组结构兼容逻辑。
- 不保留已废弃的参考生视频模式。
- 不做无关 UI 重构。

## 数据结构

`video_categories` 统一写成对象，key 是视频模式，value 是该模式的展示名称与输入资源限制。

```json
{
  "multimodal": {
    "label": "全能参考",
    "limits": {
      "image": { "min": 0, "max": 9 },
      "video": { "min": 0, "max": 3 },
      "audio": { "min": 0, "max": 3 }
    }
  },
  "frames": {
    "label": "首尾帧",
    "limits": {
      "image": { "min": 1, "max": 2 },
      "video": { "min": 0, "max": 0 },
      "audio": { "min": 0, "max": 0 }
    }
  }
}
```

### 类型约定

- `multimodal`：对应前端“全能参考”。
- `frames`：对应前端“首尾帧”。
- `image`：普通参考图片或首尾帧图片。
- `video`：参考视频。
- `audio`：参考音频。
- `min`：提交该模式时至少需要的数量。
- `max`：该模式允许的最大数量，`0` 表示该模式不允许此类资源。

## 前端行为

### 通用解析

前端新增一个共享解析工具，把 `ModelItem.video_categories` 从 `unknown` 解析为强类型对象。解析失败时按“不支持任何视频模式”处理，不放开限制。

### 创作生成页

- 模式列表来自当前模型的 `video_categories` key。
- 切换模式前检查当前已选资源是否满足目标模式限制。
- 如果不满足，阻止切换，并提示需要先删除哪些资源。
- 生成按钮点击前再次校验当前模式限制，不满足时不发接口请求。

### 画布视频节点

- 视频节点面板的模式按钮来自当前模型的 `video_categories`。
- 从全能参考切到首尾帧时，如果已有视频或音频参考，阻止切换并提示用户先断开对应连线。
- 连接输入边时，按当前模型所有模式中同类资源的最大值限制连线数量。例如所有模式中 `video.max` 最大为 3，则同一个视频节点最多连入 3 条视频边。
- 执行节点前按当前模式限制校验一次，失败时不提交 `/videos/generate`。

## 后端兜底校验

`POST /videos/generate` 查询模型时同时读取 `provider_models.video_categories`。

校验规则：

- 请求带 `images` 时按 `frames` 模式校验图片数量。
- 请求带 `reference_images`、`reference_videos` 或 `reference_audios` 时按 `multimodal` 模式校验资源数量。
- 如果请求资源无法匹配模型支持的模式，返回 400。
- 如果数量低于 `min` 或超过 `max`，返回 400，并给出明确中文错误信息。

## Seed 调整

`packages/db/scripts/seed.ts` 中视频模型的 `video_categories` 改为新对象结构并 `JSON.stringify()` 入库。

当前示例约束：

- 全能参考：图片最多 9 张，视频最多 3 个，音频最多 3 个。
- 首尾帧：图片 1 到 2 张，视频 0 个，音频 0 个。

## 测试与验证

- 类型构建：`pnpm --filter @aigc/types build`。
- API 构建：`pnpm --filter @aigc/api build`。
- Web 构建：`pnpm --filter @aigc/web build`。
- 前端手测：创作生成页和画布节点分别验证超限上传、模式切换阻止、提交前阻止。
- 后端手测：直接调用 `/videos/generate` 验证超限资源返回 400。
