● Worker 的工作机制如下：

  ---
  Worker 整体架构

  Worker 是一个独立进程，不对外暴露 HTTP 端口，专门消费 API
  投递的队列任务。

  核心组成

  1. BullMQ 队列消费者（实时任务）

  队列: image-queue
  并发: 5
  职责: 图像生成：调用 AI 适配器 → 成功/失败流水线
  ────────────────────────────────────────
  队列: transfer-queue
  并发: 5
  职责: 文件转存：把 AI 返回的临时 URL 永久化到自有 S3

  2. Pollers 轮询器（每 15 秒）

  视频/数字人/动作模仿这类异步任务，AI 服务不会主动回调，所以 worker
   主动轮询：

  - video-poller — 轮询视频生成进度（火山引擎 + VEO）
  - avatar-poller — 轮询数字人生成（即梦 Omni）
  - action-imitation-poller — 轮询动作模仿（即梦 DreamActor）

  3. 定时 Jobs（setInterval）

  - timeout-guardian（每 5 分钟）— 找出卡住超过 6
  分钟的任务，强制失败并退款
  - purge-old-records（每 24 小时）— 清理过期日志
  - purge-deleted-projects（每 24 小时）— 清理已删除项目的 S3 文件

  ---
  一次图像生成的完整链路

  API 收到请求
    → 冻结积分（frozen_credits += estimated）
    → 向 image-queue 投递任务
    → 返回 taskId 给前端

  Worker 消费 image-queue
    → 更新 task.status = 'processing'
    → 调用 AI 适配器（NanoBanana 或 火山引擎）

  成功 → completePipeline（事务）
    → 插入 assets 记录
    → 确认积分（balance -= actual，frozen -= estimated）
    → 写 credits_ledger
    → 更新 task/batch 状态
    → 发布 Redis Pub/Sub → SSE 推送前端
    → 向 transfer-queue 投递转存任务

  失败 → failPipeline（事务）
    → 退款（frozen_credits -= estimated，balance 不变）
    → 写 credits_ledger（type: refund）
    → 更新 task/batch 状态
    → 发布 SSE 事件

  ---
  视频任务的特殊处理

  视频任务不走 image-queue，API 直接调用 AI 服务提交任务后把 task_id
   存库，然后由 video-poller 每 15 秒轮询状态。轮询器还有年龄自适应
  跳过逻辑——任务越老，轮询频率越低，减少 API 调用压力。