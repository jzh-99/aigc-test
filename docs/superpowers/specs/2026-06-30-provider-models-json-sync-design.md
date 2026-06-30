# provider_models JSON 初始化与业管同步设计

## 目标

把根目录 `models.json` 作为大模型初始化数据源，清空旧的 `provider_models` 硬编码 seed 数据，并让业管平台 `/external/toby/specification-config` 回调可以用同一套转换逻辑替换单个模型配置。

## 数据结构

`provider_models.provider_id` 正式迁移为 `provider_code` 文本字段。`providers` 表暂时不变，模型查询仍可通过 `provider_code = providers.code` 逻辑关联供应商配置，但数据库层不再依赖 `providers.id` 外键。

唯一键改为 `(provider_code, code)`，表示同一个供应商下模型 code 唯一。

## 转换规则

新增共享转换模块，负责把业管模型规格转换为 `provider_models` 可写入字段：

- `modelCode -> code`
- `modelName -> name`
- `modelDesc -> description`
- `modelProvider -> provider_code`
- `modelType -> module`
- `paramsSchema -> params_schema`
- `paramsPricing -> params_pricing`

`models.json` 顶层是 `{ modelParams: [...] }[]`，初始化时先拍平成单模型数组。业管回调只处理单个 `modelParams`。

`modelType` 映射：

- `1 -> image`
- `2 -> video`
- `3 -> agent`
- `4 -> music`
- `5 -> tts`

旧版业管回调里的 `params` 数组会转换成 `params_pricing`，`resolutionRatio -> resolution`，`singleConsumeCount -> unit_price`，`modelCode -> model`。

## Seed 行为

`packages/db/scripts/seed.ts` 保留 `providers` 和系统音色等初始化，删除旧的 `provider_models` 分散硬编码插入逻辑。模型初始化阶段先删除 `provider_models` 现有记录，再读取根目录 `models.json` 插入转换后的模型数据。

这会让初始化结果以 `models.json` 为准。

## 外部回调

`POST /external/toby/specification-config` 继续使用现有入站解密验签。验签成功后转换 `payload.modelParams`，按 `(provider_code, code)` upsert：

- 存在：替换 `name`、`description`、`module`、`params_schema`、`params_pricing`，并保持启用。
- 不存在：新增模型，`is_active=true`。

回调返回仍使用 Toby 入站加密响应，业务状态 `status='0'` 表示成功。

## 验证

新增转换函数单元测试覆盖：

- `models.json` 新结构拍平和字段映射。
- 旧版 Toby `params` 数组转换。
- 不支持的 `modelType` 抛错。

迁移测试覆盖迁移脚本包含 `provider_code`、唯一键替换、删除 `provider_id`。
