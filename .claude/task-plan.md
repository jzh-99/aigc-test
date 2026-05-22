# Task Plan — video_categories 能力限制重设计

## 2026-05-21 — 实现计划阶段

## 状态说明
- [ ] 待完成
- [x] 已完成
- [~] 进行中

## 当前任务
- [x] 恢复上下文：读取设计文档、任务日志和任务计划。
- [x] 探索相关代码：types、seed、API、创作生成页、画布视频节点。
- [x] 编写实施计划：保存到 `docs/superpowers/plans/2026-05-21-video-categories-limits.md`。
- [x] 实现共享视频限制类型。
- [x] 更新视频模型 seed。
- [x] 后端生成接口兜底校验。
- [x] 改造创作生成页。
- [~] 改造画布视频节点：已把节点 config 里的 `videoCategoryLimits` 贯通到默认值和模型切换逻辑，连线校验也改为读取该快照。
- [x] 完成构建与手测验证。
