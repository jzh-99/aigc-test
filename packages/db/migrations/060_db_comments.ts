import type { Kysely } from 'kysely'
import { sql } from 'kysely'

/**
 * 迁移 060：为所有数据库表、字段、索引增加中文注释
 *
 * 重点：
 * - enum 类型的字段完整列出所有可选值及含义
 * - JSONB 字段说明存储的内容结构
 * - 索引注释说明查询用途
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  // ─── 用户与认证 ──────────────────────────────────────────────────────

  await sql`
COMMENT ON TABLE users IS '用户表，存储平台所有注册用户的基本信息、认证数据和订阅状态';
COMMENT ON COLUMN users.id IS 'UUID 主键，自动生成';
COMMENT ON COLUMN users.account IS '登录账号，用于系统登录认证';
COMMENT ON COLUMN users.email IS '邮箱地址，可为空，设有唯一索引';
COMMENT ON COLUMN users.phone IS '手机号码，可为空';
COMMENT ON COLUMN users.username IS '用户显示名，设有唯一索引';
COMMENT ON COLUMN users.password_hash IS '密码哈希值，使用 bcrypt 等算法加密存储';
COMMENT ON COLUMN users.avatar_url IS '头像图片 URL 地址，可为空';
COMMENT ON COLUMN users.role IS '用户角色，可选值：admin（管理员，拥有系统管理权限）、member（普通成员）';
COMMENT ON COLUMN users.status IS '用户状态，可选值：active（正常，可正常使用）、suspended（停用，账号被冻结）、deleted（已删除，软删除状态）';
COMMENT ON COLUMN users.plan_tier IS '订阅层级，可选值：free（免费版）、basic（基础版）、pro（专业版）、enterprise（企业版）';
COMMENT ON COLUMN users.password_change_required IS '是否需要修改密码，true 表示首次登录或密码重置后需要强制修改';
COMMENT ON COLUMN users.generation_defaults IS 'AI 生成默认参数（JSONB），存储用户自定义的生成配置，如模型偏好、默认分辨率、风格参数等';
COMMENT ON COLUMN users.created_at IS '记录创建时间';
COMMENT ON COLUMN users.updated_at IS '记录最后更新时间'
  `.execute(db)

  await sql`
COMMENT ON TABLE subscription_plans IS '订阅计划表，定义平台可用的各层级订阅方案及其权益';
COMMENT ON COLUMN subscription_plans.id IS 'UUID 主键';
COMMENT ON COLUMN subscription_plans.name IS '计划名称，如"免费版""基础版""专业版""企业版"';
COMMENT ON COLUMN subscription_plans.tier IS '订阅层级，可选值：free（免费版）、basic（基础版）、pro（专业版）、enterprise（企业版）';
COMMENT ON COLUMN subscription_plans.price_monthly IS '月度价格（单位：分，字符串存储避免精度丢失），null 表示该层级不支持月付';
COMMENT ON COLUMN subscription_plans.price_yearly IS '年度价格（单位：分，字符串存储避免精度丢失），null 表示该层级不支持年付';
COMMENT ON COLUMN subscription_plans.credits_monthly IS '每月赠送的积分数';
COMMENT ON COLUMN subscription_plans.max_concurrency IS '最大并发任务数';
COMMENT ON COLUMN subscription_plans.max_batch_size IS '单次批量操作的最大数量';
COMMENT ON COLUMN subscription_plans.features IS '功能特性列表（JSONB），存储该计划的功能开关和限额，如 {"hd_generation": true, "api_access": false}';
COMMENT ON COLUMN subscription_plans.is_active IS '是否启用'
  `.execute(db)

  await sql`
COMMENT ON TABLE user_subscriptions IS '用户订阅关系表，记录每个用户的订阅计划绑定及有效期';
COMMENT ON COLUMN user_subscriptions.id IS 'UUID 主键';
COMMENT ON COLUMN user_subscriptions.user_id IS '关联用户 ID（外键 → users.id）';
COMMENT ON COLUMN user_subscriptions.plan_id IS '关联订阅计划 ID（外键 → subscription_plans.id）';
COMMENT ON COLUMN user_subscriptions.status IS '订阅状态，可选值：active（生效中）、expired（已过期）、cancelled（已取消）';
COMMENT ON COLUMN user_subscriptions.started_at IS '订阅生效开始时间';
COMMENT ON COLUMN user_subscriptions.expires_at IS '订阅到期时间';
COMMENT ON COLUMN user_subscriptions.created_at IS '记录创建时间';
COMMENT ON INDEX idx_user_subscriptions_active IS '用户订阅活跃状态索引，用于快速查询用户当前生效的订阅'
  `.execute(db)

  await sql`
COMMENT ON TABLE refresh_tokens IS '刷新令牌表，存储用于 JWT 无感刷新的长期令牌';
COMMENT ON COLUMN refresh_tokens.id IS 'UUID 主键';
COMMENT ON COLUMN refresh_tokens.user_id IS '关联用户 ID（外键 → users.id）';
COMMENT ON COLUMN refresh_tokens.token_hash IS '刷新令牌的哈希值，原始令牌仅在创建时返回一次给客户端';
COMMENT ON COLUMN refresh_tokens.expires_at IS '令牌过期时间，过期后需重新登录';
COMMENT ON COLUMN refresh_tokens.revoked_at IS '令牌撤销时间，null 表示令牌有效，非 null 表示已被主动吊销';
COMMENT ON COLUMN refresh_tokens.created_at IS '记录创建时间';
COMMENT ON INDEX idx_refresh_tokens_user IS '用户 ID 索引，用于查询某用户的所有刷新令牌（如登出时批量撤销）'
  `.execute(db)

  await sql`
COMMENT ON TABLE email_verifications IS '邮箱验证令牌表，存储邮箱验证和密码重置的一次性令牌';
COMMENT ON COLUMN email_verifications.id IS 'UUID 主键';
COMMENT ON COLUMN email_verifications.user_id IS '关联用户 ID（外键 → users.id）';
COMMENT ON COLUMN email_verifications.token_hash IS '验证令牌的哈希值，原始令牌通过邮件发送给用户';
COMMENT ON COLUMN email_verifications.type IS '验证类型，可选值：verify_email（邮箱验证）、reset_password（重置密码）';
COMMENT ON COLUMN email_verifications.expires_at IS '令牌过期时间';
COMMENT ON COLUMN email_verifications.used_at IS '令牌使用时间，null 表示尚未使用（有效）';
COMMENT ON COLUMN email_verifications.created_at IS '记录创建时间';
COMMENT ON INDEX idx_email_verifications_user IS '用户 ID 与类型联合索引，用于查询某用户特定类型的验证令牌'
  `.execute(db)

  // ─── 团队 ────────────────────────────────────────────────────────────

  await sql`
COMMENT ON TABLE teams IS '团队表，支持多人协作的组织单元，独立管理成员和订阅';
COMMENT ON COLUMN teams.id IS 'UUID 主键';
COMMENT ON COLUMN teams.name IS '团队名称';
COMMENT ON COLUMN teams.owner_id IS '团队所有者 ID（外键 → users.id）';
COMMENT ON COLUMN teams.plan_tier IS '团队订阅层级，可选值：free（免费版）、basic（基础版）、pro（专业版）、enterprise（企业版）';
COMMENT ON COLUMN teams.team_type IS '团队类型，可选值：standard（标准团队）、company_a（企业 A 定制版）、avatar_enabled（启用数字人功能的团队）';
COMMENT ON COLUMN teams.allow_member_topup IS '是否允许团队成员自行充值积分';
COMMENT ON COLUMN teams.is_deleted IS '是否软删除';
COMMENT ON COLUMN teams.deleted_at IS '软删除时间，null 表示未被删除';
COMMENT ON COLUMN teams.created_at IS '记录创建时间';
COMMENT ON COLUMN teams.updated_at IS '记录最后更新时间'
  `.execute(db)

  await sql`
COMMENT ON TABLE team_members IS '团队成员关系表，管理团队与用户的多对多关系及成员权限';
COMMENT ON COLUMN team_members.team_id IS '关联团队 ID（外键 → teams.id，与 user_id 组成复合主键）';
COMMENT ON COLUMN team_members.user_id IS '关联用户 ID（外键 → users.id，与 team_id 组成复合主键）';
COMMENT ON COLUMN team_members.role IS '成员角色，可选值：owner（所有者，团队最高权限）、admin（管理员）、editor（编辑者）、viewer（只读成员）';
COMMENT ON COLUMN team_members.joined_at IS '成员加入团队的时间';
COMMENT ON COLUMN team_members.credit_quota IS '积分配额上限，null 表示不限制（使用团队总额度）';
COMMENT ON COLUMN team_members.credit_used IS '已使用的积分数';
COMMENT ON COLUMN team_members.quota_period IS '配额重置周期，可选值：weekly（每周重置）、monthly（每月重置）、null（永久配额）';
COMMENT ON COLUMN team_members.quota_reset_at IS '配额下次重置时间';
COMMENT ON COLUMN team_members.priority_boost IS '是否启用优先加速（生成任务享有更高队列优先级）'
  `.execute(db)

  await sql`
COMMENT ON TABLE team_subscriptions IS '团队订阅关系表，记录团队的订阅计划绑定及有效期';
COMMENT ON COLUMN team_subscriptions.id IS 'UUID 主键';
COMMENT ON COLUMN team_subscriptions.team_id IS '关联团队 ID（外键 → teams.id）';
COMMENT ON COLUMN team_subscriptions.plan_id IS '关联订阅计划 ID（外键 → subscription_plans.id）';
COMMENT ON COLUMN team_subscriptions.status IS '订阅状态，可选值：active（生效中）、expired（已过期）、cancelled（已取消）';
COMMENT ON COLUMN team_subscriptions.started_at IS '订阅生效开始时间';
COMMENT ON COLUMN team_subscriptions.expires_at IS '订阅到期时间';
COMMENT ON COLUMN team_subscriptions.created_at IS '记录创建时间';
COMMENT ON INDEX idx_team_subscriptions_active IS '团队订阅活跃状态索引'
  `.execute(db)

  await sql`
COMMENT ON TABLE workspaces IS '工作空间表，团队下的内容组织单元，用于隔离不同项目或业务场景';
COMMENT ON COLUMN workspaces.id IS 'UUID 主键';
COMMENT ON COLUMN workspaces.team_id IS '关联团队 ID（外键 → teams.id）';
COMMENT ON COLUMN workspaces.name IS '工作空间名称';
COMMENT ON COLUMN workspaces.description IS '工作空间描述说明，可为空';
COMMENT ON COLUMN workspaces.created_by IS '创建者用户 ID（外键 → users.id）';
COMMENT ON COLUMN workspaces.is_deleted IS '是否软删除';
COMMENT ON COLUMN workspaces.deleted_at IS '软删除时间';
COMMENT ON COLUMN workspaces.created_at IS '记录创建时间'
  `.execute(db)

  await sql`
COMMENT ON TABLE workspace_members IS '工作空间成员关系表，管理工作空间与用户的关联及权限';
COMMENT ON COLUMN workspace_members.id IS 'UUID 主键';
COMMENT ON COLUMN workspace_members.workspace_id IS '关联工作空间 ID（外键 → workspaces.id）';
COMMENT ON COLUMN workspace_members.user_id IS '关联用户 ID（外键 → users.id）';
COMMENT ON COLUMN workspace_members.role IS '成员角色，可选值：admin（管理员）、editor（编辑者）、viewer（只读成员）';
COMMENT ON COLUMN workspace_members.created_at IS '记录创建时间';
COMMENT ON INDEX idx_ws_members_user IS '用户 ID 索引，用于查询某用户加入的所有工作空间'
  `.execute(db)

  // ─── 积分 ────────────────────────────────────────────────────────────

  await sql`
COMMENT ON TABLE credit_accounts IS '积分账户表 — 管理用户或团队的积分余额、冻结额度及累计收支';
COMMENT ON COLUMN credit_accounts.id IS 'UUID 主键';
COMMENT ON COLUMN credit_accounts.owner_type IS '所有者类型，可选值：user（个人账户）、team（团队账户）';
COMMENT ON COLUMN credit_accounts.user_id IS '关联用户 ID（owner_type=user 时必填，与 team_id 二选一）';
COMMENT ON COLUMN credit_accounts.team_id IS '关联团队 ID（owner_type=team 时必填，与 user_id 二选一）';
COMMENT ON COLUMN credit_accounts.balance IS '当前可用积分余额（>=0，且 >= frozen_credits）';
COMMENT ON COLUMN credit_accounts.frozen_credits IS '冻结中积分数（任务执行中预扣，>=0）';
COMMENT ON COLUMN credit_accounts.total_earned IS '累计获得积分总额';
COMMENT ON COLUMN credit_accounts.total_spent IS '累计消耗积分总额';
COMMENT ON COLUMN credit_accounts.updated_at IS '最后更新时间'
  `.execute(db)

  await sql`
COMMENT ON TABLE credits_ledger IS '积分流水表 — 记录所有积分变动明细，包括充值、消耗、冻结、退款等';
COMMENT ON COLUMN credits_ledger.id IS 'UUID 主键';
COMMENT ON COLUMN credits_ledger.credit_account_id IS '关联积分账户 ID';
COMMENT ON COLUMN credits_ledger.user_id IS '操作用户 ID（执行该笔变动的用户）';
COMMENT ON COLUMN credits_ledger.amount IS '变动金额（正数=入账，负数=扣减）';
COMMENT ON COLUMN credits_ledger.type IS '流水类型，可选值：topup（充值）、subscription（订阅发放）、freeze（冻结/预扣）、confirm（确认扣减）、refund（退款）、bonus（奖励）、expire（过期清零）';
COMMENT ON COLUMN credits_ledger.task_id IS '关联任务 ID（任务相关流水）';
COMMENT ON COLUMN credits_ledger.batch_id IS '关联批次 ID（批量任务相关流水）';
COMMENT ON COLUMN credits_ledger.description IS '流水描述（人类可读的变动说明）';
COMMENT ON COLUMN credits_ledger.created_at IS '创建时间';
COMMENT ON INDEX idx_credits_ledger_account IS '积分流水按账户+时间查询（用于账户明细列表）';
COMMENT ON INDEX idx_credits_ledger_user IS '积分流水按用户+时间查询（用于用户积分记录）'
  `.execute(db)

  // ─── 任务 ────────────────────────────────────────────────────────────

  await sql`
COMMENT ON TABLE task_batches IS '任务批次表 — 每次生成请求创建一个批次，包含一个或多个子任务';
COMMENT ON COLUMN task_batches.id IS 'UUID 主键';
COMMENT ON COLUMN task_batches.user_id IS '创建用户 ID';
COMMENT ON COLUMN task_batches.team_id IS '关联团队 ID';
COMMENT ON COLUMN task_batches.workspace_id IS '关联工作空间 ID';
COMMENT ON COLUMN task_batches.credit_account_id IS '关联积分账户 ID（扣费来源）';
COMMENT ON COLUMN task_batches.parent_batch_id IS '父批次 ID（子批次关联，如画布节点产生的子任务）';
COMMENT ON COLUMN task_batches.idempotency_key IS '幂等键（防重复提交，唯一约束）';
COMMENT ON COLUMN task_batches.source IS '来源，可选值：generation（生成页）、studio（视频工作室）、canvas（画布）';
COMMENT ON COLUMN task_batches.module IS '功能模块，可选值：image（图片生成）、video（视频生成）、tts（文本转语音）、lipsync（口型同步）、agent（AI助手）、avatar（数字人）、action_imitation（动作模仿）、storyboard（分镜）、upload（上传）、music（音乐生成）、music_voice_clone（音色克隆）、picture_book（AI绘本）、short_drama（短剧）';
COMMENT ON COLUMN task_batches.provider IS 'AI 供应商代码（如 volcengine）';
COMMENT ON COLUMN task_batches.model IS 'AI 模型代码（如 doubao-seedream-3.0）';
COMMENT ON COLUMN task_batches.prompt IS '用户输入的提示词';
COMMENT ON COLUMN task_batches.params IS '请求参数（JSONB），包含分辨率、时长、风格等模型参数';
COMMENT ON COLUMN task_batches.quantity IS '批次内任务总数';
COMMENT ON COLUMN task_batches.completed_count IS '已完成任务数';
COMMENT ON COLUMN task_batches.failed_count IS '失败任务数';
COMMENT ON COLUMN task_batches.status IS '批次状态，可选值：pending（待处理）、processing（处理中）、completed（全部完成）、partial_complete（部分完成）、failed（全部失败）';
COMMENT ON COLUMN task_batches.estimated_credits IS '预估积分消耗（提交时计算）';
COMMENT ON COLUMN task_batches.actual_credits IS '实际积分消耗（完成后填入）';
COMMENT ON COLUMN task_batches.is_hidden IS '是否对用户隐藏';
COMMENT ON COLUMN task_batches.is_deleted IS '是否软删除';
COMMENT ON COLUMN task_batches.deleted_at IS '软删除时间';
COMMENT ON COLUMN task_batches.canvas_id IS '关联画布 ID（source=canvas 时）';
COMMENT ON COLUMN task_batches.canvas_node_id IS '关联画布节点 ID';
COMMENT ON COLUMN task_batches.video_studio_project_id IS '关联视频工作室项目 ID';
COMMENT ON COLUMN task_batches.picture_book_project_id IS '关联绘本项目 ID';
COMMENT ON COLUMN task_batches.short_drama_project_id IS '关联短剧项目 ID';
COMMENT ON COLUMN task_batches.short_drama_episode_id IS '关联短剧集 ID';
COMMENT ON COLUMN task_batches.short_drama_segment_id IS '关联短剧片段 ID';
COMMENT ON COLUMN task_batches.created_at IS '创建时间';
COMMENT ON COLUMN task_batches.updated_at IS '最后更新时间';
COMMENT ON INDEX idx_batches_user IS '任务批次按用户+时间查询（用于用户历史列表）';
COMMENT ON INDEX idx_batches_idem IS '幂等键唯一索引（防重复提交）';
COMMENT ON INDEX idx_batches_processing IS '处理中批次扫描索引（超时守护进程定时扫描，部分索引 WHERE status = ''processing''）';
COMMENT ON INDEX idx_task_batches_canvas_active IS '画布活跃任务查询索引（部分索引 WHERE status IN (''pending'', ''processing'')）';
COMMENT ON INDEX idx_task_batches_video_studio_project_created IS '视频工作室项目按创建时间倒序查询（部分索引 WHERE video_studio_project_id IS NOT NULL）';
COMMENT ON INDEX idx_task_batches_picture_book_project_created IS '绘本项目按创建时间倒序查询（部分索引 WHERE picture_book_project_id IS NOT NULL）';
COMMENT ON INDEX idx_task_batches_short_drama_project_created IS '短剧项目按创建时间倒序查询（部分索引 WHERE short_drama_project_id IS NOT NULL）';
COMMENT ON INDEX idx_task_batches_source_workspace_created IS '按来源+工作空间+创建时间联合查询';
COMMENT ON INDEX idx_task_batches_source_module_feature IS '按来源+功能模块+特性联合查询';
COMMENT ON INDEX idx_task_batches_source_project IS '按来源+项目 ID 联合查询'
  `.execute(db)

  await sql`
COMMENT ON TABLE tasks IS '任务表 — 批次下的单个执行任务，对应一次 AI 调用';
COMMENT ON COLUMN tasks.id IS 'UUID 主键';
COMMENT ON COLUMN tasks.batch_id IS '关联批次 ID（外键 → task_batches.id）';
COMMENT ON COLUMN tasks.user_id IS '创建用户 ID';
COMMENT ON COLUMN tasks.version_index IS '版本序号（同一 prompt 可生成多版本，从 0 开始）';
COMMENT ON COLUMN tasks.queue_job_id IS 'BullMQ 队列任务 ID';
COMMENT ON COLUMN tasks.external_task_id IS '外部 AI 服务返回的任务 ID';
COMMENT ON COLUMN tasks.status IS '任务状态，可选值：pending（待处理）、processing（处理中）、completed（已完成）、failed（失败）';
COMMENT ON COLUMN tasks.retry_count IS '重试次数（失败后自动重试）';
COMMENT ON COLUMN tasks.estimated_credits IS '预估积分消耗';
COMMENT ON COLUMN tasks.credits_cost IS '实际扣减积分（任务完成后填入）';
COMMENT ON COLUMN tasks.provider_cost_raw IS '供应商原始成本数据（JSONB），存储 AI 服务商返回的计费明细';
COMMENT ON COLUMN tasks.processing_started_at IS '开始处理时间（Worker 开始执行的时间）';
COMMENT ON COLUMN tasks.completed_at IS '完成时间（成功或失败的时间）';
COMMENT ON COLUMN tasks.error_message IS '错误信息（任务失败时记录原因）';
COMMENT ON INDEX idx_tasks_batch IS '任务按批次查询（获取批次下所有子任务）';
COMMENT ON INDEX idx_tasks_ext_id IS '外部任务 ID 索引（AI 服务回调时匹配任务）';
COMMENT ON INDEX idx_tasks_active IS '活跃任务扫描索引（超时守护进程扫描，部分索引 WHERE status IN (''pending'', ''processing'')）'
  `.execute(db)

  await sql`
COMMENT ON TABLE assets IS '资产表 — 任务生成的产出物（图片、视频、音频等）';
COMMENT ON COLUMN assets.id IS 'UUID 主键';
COMMENT ON COLUMN assets.task_id IS '关联任务 ID（唯一，一个任务产生一个资产）';
COMMENT ON COLUMN assets.batch_id IS '关联批次 ID';
COMMENT ON COLUMN assets.user_id IS '所属用户 ID';
COMMENT ON COLUMN assets.type IS '资产类型，可选值：image（图片）、video（视频）、audio（音频）';
COMMENT ON COLUMN assets.storage_url IS 'TOS 存储地址（从 AI 服务转存到内部存储后的 URL）';
COMMENT ON COLUMN assets.original_url IS '原始 URL（AI 服务返回的临时下载地址）';
COMMENT ON COLUMN assets.thumbnail_url IS '缩略图 URL';
COMMENT ON COLUMN assets.transfer_status IS '转存状态，可选值：pending（待转存）、completed（已转存）、failed（转存失败）';
COMMENT ON COLUMN assets.file_size IS '文件大小（字节）';
COMMENT ON COLUMN assets.duration IS '时长（秒，视频/音频类型适用）';
COMMENT ON COLUMN assets.width IS '宽度（像素，图片/视频类型适用）';
COMMENT ON COLUMN assets.height IS '高度（像素，图片/视频类型适用）';
COMMENT ON COLUMN assets.metadata IS '扩展元数据（JSONB），存储模型特有信息，如图片的 seed、视频的 fps 等';
COMMENT ON COLUMN assets.is_deleted IS '是否软删除';
COMMENT ON COLUMN assets.deleted_at IS '软删除时间';
COMMENT ON COLUMN assets.created_at IS '创建时间';
COMMENT ON INDEX idx_assets_user IS '资产按用户+时间查询（用于用户资产列表）';
COMMENT ON INDEX idx_assets_batch IS '资产按批次查询（获取批次下所有产出物）'
  `.execute(db)

  // ─── 供应商 ──────────────────────────────────────────────────────────

  await sql`
COMMENT ON TABLE providers IS 'AI 供应商表，存储 AI 服务提供商的基本信息和配置';
COMMENT ON COLUMN providers.id IS 'UUID 主键';
COMMENT ON COLUMN providers.code IS '供应商唯一代码（如 volcengine、gemini），全局唯一';
COMMENT ON COLUMN providers.name IS '供应商显示名称（如"火山引擎"、"Google Gemini"）';
COMMENT ON COLUMN providers.region IS '服务区域，可选值：cn（国内）、global（国际）';
COMMENT ON COLUMN providers.modules IS '支持的模块列表（JSONB），存储数组格式，如 ["image","video","tts"]';
COMMENT ON COLUMN providers.is_active IS '是否启用';
COMMENT ON COLUMN providers.config IS '供应商配置（JSONB），存储 API 密钥、请求端点、鉴权参数等'
  `.execute(db)

  await sql`
COMMENT ON TABLE provider_models IS '供应商模型表，存储各 AI 供应商提供的模型信息及定价配置';
COMMENT ON COLUMN provider_models.id IS 'UUID 主键';
COMMENT ON COLUMN provider_models.provider_id IS '关联供应商 ID（外键 → providers.id）';
COMMENT ON COLUMN provider_models.code IS '模型唯一代码（如 seedance-1.0-pro），与 provider_id 组合唯一';
COMMENT ON COLUMN provider_models.name IS '模型显示名称';
COMMENT ON COLUMN provider_models.description IS '模型描述文本';
COMMENT ON COLUMN provider_models.module IS '功能模块，可选值：image（图片生成）、video（视频生成）、tts（文本转语音）、lipsync（口型同步）、agent（AI助手）、avatar（数字人）、action_imitation（动作模仿）、music（音乐生成）、music_voice_clone（音色克隆）';
COMMENT ON COLUMN provider_models.category_references IS '分类引用配置（JSONB），定义模型支持的参考素材类型及数量限制';
COMMENT ON COLUMN provider_models.params_pricing IS '参数定价配置（JSONB），存储不同参数组合对应的积分消耗规则数组';
COMMENT ON COLUMN provider_models.params_schema IS '参数 Schema（JSONB），定义模型可接受的参数名称、类型及校验规则，供前端表单渲染和后端参数校验使用';
COMMENT ON COLUMN provider_models.resolution IS '模型默认分辨率标识（如 "720p"、"1080p"、"2k"）';
COMMENT ON COLUMN provider_models.is_active IS '是否启用';
COMMENT ON INDEX idx_provider_models_provider IS '按供应商 ID 查询模型的索引'
  `.execute(db)

  await sql`
COMMENT ON TABLE provider_system_voices IS '供应商系统语音表，存储各 AI 供应商提供的预制系统语音';
COMMENT ON COLUMN provider_system_voices.id IS 'UUID 主键';
COMMENT ON COLUMN provider_system_voices.provider_id IS '关联供应商 ID（外键 → providers.id）';
COMMENT ON COLUMN provider_system_voices.voice_id IS '语音在供应商系统中的唯一标识';
COMMENT ON COLUMN provider_system_voices.name IS '语音显示名称';
COMMENT ON COLUMN provider_system_voices.language IS '支持的语言标识（如 zh-CN、en-US）';
COMMENT ON COLUMN provider_system_voices.metadata IS '语音元数据（JSONB），包含性别、年龄感、风格标签等属性';
COMMENT ON COLUMN provider_system_voices.demo_audio_url IS '试听音频 URL';
COMMENT ON COLUMN provider_system_voices.is_active IS '是否启用';
COMMENT ON COLUMN provider_system_voices.created_at IS '创建时间';
COMMENT ON INDEX idx_provider_system_voices_provider IS '按供应商 ID 查询系统语音的索引'
  `.execute(db)

  await sql`
COMMENT ON TABLE team_model_configs IS '团队模型配置表，控制哪些模型对哪些团队可用';
COMMENT ON COLUMN team_model_configs.id IS 'UUID 主键';
COMMENT ON COLUMN team_model_configs.team_id IS '关联团队 ID（外键 → teams.id）';
COMMENT ON COLUMN team_model_configs.model_id IS '关联供应商模型 ID（外键 → provider_models.id）';
COMMENT ON COLUMN team_model_configs.is_active IS '该模型是否对该团队启用';
COMMENT ON COLUMN team_model_configs.created_at IS '创建时间';
COMMENT ON COLUMN team_model_configs.updated_at IS '更新时间';
COMMENT ON INDEX idx_team_model_configs_team IS '按团队 ID 查询模型配置的索引'
  `.execute(db)

  await sql`
COMMENT ON TABLE voice_profiles IS '用户音色档案表，存储用户通过音频样本训练的个性化音色';
COMMENT ON COLUMN voice_profiles.id IS 'UUID 主键';
COMMENT ON COLUMN voice_profiles.user_id IS '所属用户 ID（外键 → users.id）';
COMMENT ON COLUMN voice_profiles.name IS '音色名称，由用户自定义';
COMMENT ON COLUMN voice_profiles.provider IS '语音供应商代码';
COMMENT ON COLUMN voice_profiles.external_voice_id IS '供应商侧返回的外部语音 ID';
COMMENT ON COLUMN voice_profiles.sample_asset_id IS '样本音频资产 ID';
COMMENT ON COLUMN voice_profiles.status IS '音色训练状态，可选值：pending（训练中）、ready（可用）、failed（训练失败）';
COMMENT ON COLUMN voice_profiles.is_deleted IS '是否软删除';
COMMENT ON COLUMN voice_profiles.created_at IS '创建时间'
  `.execute(db)

  await sql`
COMMENT ON TABLE prompt_filter_rules IS '提示词过滤规则表，用于内容安全审核，拦截或标记违规输入';
COMMENT ON COLUMN prompt_filter_rules.id IS 'UUID 主键';
COMMENT ON COLUMN prompt_filter_rules.pattern IS '匹配模式，存储关键词字符串或正则表达式';
COMMENT ON COLUMN prompt_filter_rules.type IS '规则类型，可选值：keyword（关键词精确匹配）、regex（正则表达式匹配）';
COMMENT ON COLUMN prompt_filter_rules.action IS '处理动作，可选值：reject（直接拒绝请求）、flag（标记待人工审核）';
COMMENT ON COLUMN prompt_filter_rules.description IS '规则说明';
COMMENT ON COLUMN prompt_filter_rules.is_active IS '是否启用';
COMMENT ON COLUMN prompt_filter_rules.created_at IS '创建时间'
  `.execute(db)

  // ─── 画布 ────────────────────────────────────────────────────────────

  await sql`
COMMENT ON TABLE canvases IS '画布表，存储用户创建的 AI 创作画布，基于 ReactFlow 节点编辑器';
COMMENT ON COLUMN canvases.id IS 'UUID 主键';
COMMENT ON COLUMN canvases.workspace_id IS '关联工作空间 ID（外键 → workspaces.id）';
COMMENT ON COLUMN canvases.user_id IS '创建者用户 ID（外键 → users.id）';
COMMENT ON COLUMN canvases.name IS '画布名称';
COMMENT ON COLUMN canvases.thumbnail_url IS '缩略图 URL';
COMMENT ON COLUMN canvases.structure_data IS '画布结构数据（JSONB），存储 ReactFlow 节点(nodes)和边(edges)的完整序列化数据';
COMMENT ON COLUMN canvases.version IS '数据版本号（乐观锁），每次保存自增，用于并发编辑冲突检测';
COMMENT ON COLUMN canvases.is_deleted IS '是否软删除';
COMMENT ON COLUMN canvases.deleted_at IS '软删除时间';
COMMENT ON COLUMN canvases.created_at IS '创建时间';
COMMENT ON COLUMN canvases.updated_at IS '更新时间';
COMMENT ON INDEX idx_canvases_workspace IS '按工作空间查询画布并按更新时间倒序排列的复合索引'
  `.execute(db)

  await sql`
COMMENT ON TABLE canvas_node_outputs IS '画布节点输出表，记录画布中每个节点产生的 AI 生成结果';
COMMENT ON COLUMN canvas_node_outputs.id IS 'UUID 主键';
COMMENT ON COLUMN canvas_node_outputs.canvas_id IS '关联画布 ID（外键 → canvases.id）';
COMMENT ON COLUMN canvas_node_outputs.node_id IS '画布中节点的 ID，对应 structure_data 中的节点标识';
COMMENT ON COLUMN canvas_node_outputs.batch_id IS '关联任务批次 ID';
COMMENT ON COLUMN canvas_node_outputs.output_urls IS '输出资源 URL 列表（JSONB 数组），包含生成的图片、视频或音频地址';
COMMENT ON COLUMN canvas_node_outputs.params_snapshot IS '生成时的参数快照（JSONB），记录本次生成使用的完整参数';
COMMENT ON COLUMN canvas_node_outputs.is_selected IS '是否为当前选中版本（同一节点下只能有一条为 true）';
COMMENT ON COLUMN canvas_node_outputs.created_at IS '创建时间';
COMMENT ON INDEX idx_canvas_node_outputs_lookup IS '按画布和节点查询输出结果的复合索引，按创建时间倒序'
  `.execute(db)

  await sql`
COMMENT ON TABLE canvas_agent_sessions IS '画布 AI 助手会话表，每个画布对应一个 AI 助手会话';
COMMENT ON COLUMN canvas_agent_sessions.id IS 'UUID 主键';
COMMENT ON COLUMN canvas_agent_sessions.canvas_id IS '关联画布 ID（外键 → canvases.id）';
COMMENT ON COLUMN canvas_agent_sessions.session IS 'AI 助手会话数据（JSONB），存储完整的对话历史和上下文信息';
COMMENT ON COLUMN canvas_agent_sessions.created_at IS '创建时间';
COMMENT ON COLUMN canvas_agent_sessions.updated_at IS '更新时间';
COMMENT ON INDEX idx_canvas_agent_sessions_lookup IS '按画布 ID 查询 AI 助手会话的索引'
  `.execute(db)

  // ─── 视频工作室 ──────────────────────────────────────────────────────

  await sql`
COMMENT ON TABLE video_studio_projects IS '视频工作室项目表，存储用户创建的 AI 视频生成项目';
COMMENT ON COLUMN video_studio_projects.id IS 'UUID 主键';
COMMENT ON COLUMN video_studio_projects.workspace_id IS '关联工作空间 ID（外键 → workspaces.id）';
COMMENT ON COLUMN video_studio_projects.user_id IS '创建者用户 ID（外键 → users.id）';
COMMENT ON COLUMN video_studio_projects.name IS '项目名称';
COMMENT ON COLUMN video_studio_projects.wizard_state IS '向导状态数据（JSONB），存储角色设定、分镜配置、音频选择、样式参数等';
COMMENT ON COLUMN video_studio_projects.project_type IS '项目类型，可选值：single（单集独立项目）、series（系列项目，作为父级）、episode（系列中的单集，关联 series_parent_id）';
COMMENT ON COLUMN video_studio_projects.series_parent_id IS '系列项目 ID（仅 episode 类型时使用，外键 → video_studio_projects.id）';
COMMENT ON COLUMN video_studio_projects.episode_index IS '集数序号（仅 episode 类型时使用）';
COMMENT ON COLUMN video_studio_projects.is_deleted IS '是否软删除';
COMMENT ON COLUMN video_studio_projects.deleted_at IS '软删除时间';
COMMENT ON COLUMN video_studio_projects.created_at IS '创建时间';
COMMENT ON COLUMN video_studio_projects.updated_at IS '更新时间';
COMMENT ON INDEX idx_video_studio_projects_workspace IS '按工作空间查询项目并按更新时间倒序';
COMMENT ON INDEX idx_video_studio_projects_series_parent IS '按系列父级查询所有子集的索引';
COMMENT ON INDEX idx_video_studio_projects_type_workspace IS '按工作空间和项目类型查询并按更新时间倒序'
  `.execute(db)

  // ─── 音乐 ────────────────────────────────────────────────────────────

  await sql`
COMMENT ON TABLE music_voice_clones IS '音乐音色克隆表 — 存储用户上传音频克隆生成的音色信息';
COMMENT ON COLUMN music_voice_clones.id IS 'UUID 主键';
COMMENT ON COLUMN music_voice_clones.workspace_id IS '关联工作空间 ID';
COMMENT ON COLUMN music_voice_clones.user_id IS '创建者用户 ID';
COMMENT ON COLUMN music_voice_clones.team_id IS '关联团队 ID';
COMMENT ON COLUMN music_voice_clones.batch_id IS '关联任务批次 ID';
COMMENT ON COLUMN music_voice_clones.task_id IS '关联任务 ID';
COMMENT ON COLUMN music_voice_clones.name IS '音色名称';
COMMENT ON COLUMN music_voice_clones.description IS '音色描述';
COMMENT ON COLUMN music_voice_clones.gender IS '性别，可选值：auto（自动检测）、male（男声）、female（女声）';
COMMENT ON COLUMN music_voice_clones.source_audio_url IS '原始音频 URL（用户上传的音频文件地址）';
COMMENT ON COLUMN music_voice_clones.source_audio_storage_url IS '转存后的内部存储 URL（火山 TOS 等对象存储地址）';
COMMENT ON COLUMN music_voice_clones.voice_id IS '克隆成功后的内部音色 ID';
COMMENT ON COLUMN music_voice_clones.external_voice_id IS '外部 AI 服务返回的音色 ID';
COMMENT ON COLUMN music_voice_clones.external_task_id IS '外部 AI 服务的任务 ID，用于回调查询';
COMMENT ON COLUMN music_voice_clones.status IS '处理状态，可选值：pending（待处理）、processing（训练中）、ready（可用）、failed（失败）';
COMMENT ON COLUMN music_voice_clones.error_message IS '失败时的错误信息';
COMMENT ON COLUMN music_voice_clones.created_at IS '创建时间';
COMMENT ON COLUMN music_voice_clones.updated_at IS '最后更新时间';
COMMENT ON INDEX idx_music_voice_clones_workspace_created IS '按工作空间和创建时间查询音色克隆列表';
COMMENT ON INDEX idx_music_voice_clones_batch IS '按任务批次查询关联的音色克隆';
COMMENT ON INDEX idx_music_voice_clones_task IS '按任务查询关联的音色克隆';
COMMENT ON INDEX idx_music_voice_clones_external_task_id IS '按外部任务 ID 查询（部分索引，仅非空记录，用于 webhook 回调匹配）';
COMMENT ON INDEX idx_music_voice_clones_voice_id IS '按内部音色 ID 查询（部分索引，仅非空记录）'
  `.execute(db)

  await sql`
COMMENT ON TABLE music_tracks IS '音乐曲目表 — 存储 AI 生成的歌曲和纯音乐作品';
COMMENT ON COLUMN music_tracks.id IS 'UUID 主键';
COMMENT ON COLUMN music_tracks.workspace_id IS '关联工作空间 ID';
COMMENT ON COLUMN music_tracks.user_id IS '创建者用户 ID';
COMMENT ON COLUMN music_tracks.team_id IS '关联团队 ID';
COMMENT ON COLUMN music_tracks.batch_id IS '关联任务批次 ID';
COMMENT ON COLUMN music_tracks.task_id IS '关联任务 ID';
COMMENT ON COLUMN music_tracks.type IS '曲目类型，可选值：song（歌曲，含人声）、instrumental（纯音乐，无人声）';
COMMENT ON COLUMN music_tracks.mode IS '生成模式，可选值：inspiration（灵感模式，AI 自动生成）、custom（自定义模式，用户提供歌词或参数）';
COMMENT ON COLUMN music_tracks.title IS '曲目标题';
COMMENT ON COLUMN music_tracks.prompt IS '音乐描述提示词';
COMMENT ON COLUMN music_tracks.lyrics IS '歌词文本（纯文本格式）';
COMMENT ON COLUMN music_tracks.lyrics_sections IS '歌词分段数据（JSONB 数组），每个元素包含段落类型（verse=主歌、chorus=副歌、bridge=桥段、intro=前奏、outro=尾奏）及对应歌词内容';
COMMENT ON COLUMN music_tracks.styles IS '音乐风格标签列表（JSONB 字符串数组），如 ["pop","rock","jazz"]';
COMMENT ON COLUMN music_tracks.voice_clone_id IS '关联音色克隆 ID';
COMMENT ON COLUMN music_tracks.voice_gender IS '声音性别，可选值：auto（自动匹配）、male（男声）、female（女声）';
COMMENT ON COLUMN music_tracks.model IS '使用的 AI 音乐模型代码（如 suno-v3）';
COMMENT ON COLUMN music_tracks.cover_url IS '封面图原始 URL';
COMMENT ON COLUMN music_tracks.cover_storage_url IS '封面图转存后内部存储 URL';
COMMENT ON COLUMN music_tracks.stream_url IS '流式播放 URL';
COMMENT ON COLUMN music_tracks.audio_url IS '音频文件原始 URL';
COMMENT ON COLUMN music_tracks.audio_storage_url IS '音频文件转存后内部存储 URL';
COMMENT ON COLUMN music_tracks.flac_url IS 'FLAC 无损格式音频 URL';
COMMENT ON COLUMN music_tracks.flac_storage_url IS 'FLAC 格式转存后内部存储 URL';
COMMENT ON COLUMN music_tracks.wav_url IS 'WAV 格式音频 URL';
COMMENT ON COLUMN music_tracks.wav_storage_url IS 'WAV 格式转存后内部存储 URL';
COMMENT ON COLUMN music_tracks.duration_seconds IS '音频时长（秒）';
COMMENT ON COLUMN music_tracks.external_task_id IS '外部 AI 服务的任务 ID，用于回调查询';
COMMENT ON COLUMN music_tracks.status IS '处理状态，可选值：pending（待处理）、lyrics_generating（歌词生成中）、song_generating（歌曲生成中）、cover_generating（封面生成中）、transferring（文件转存中）、completed（已完成）、failed（失败）';
COMMENT ON COLUMN music_tracks.error_message IS '失败时的错误信息';
COMMENT ON COLUMN music_tracks.created_at IS '创建时间';
COMMENT ON COLUMN music_tracks.updated_at IS '最后更新时间';
COMMENT ON INDEX idx_music_tracks_workspace_created IS '按工作空间和创建时间查询曲目列表（含 id 用于分页排序）';
COMMENT ON INDEX idx_music_tracks_batch IS '按任务批次查询关联的曲目'
  `.execute(db)

  // ─── AI 绘本 ─────────────────────────────────────────────────────────

  await sql`
COMMENT ON TABLE picture_book_projects IS 'AI 绘本项目表 — 存储用户的 AI 绘本创作项目';
COMMENT ON COLUMN picture_book_projects.id IS 'UUID 主键';
COMMENT ON COLUMN picture_book_projects.workspace_id IS '关联工作空间 ID';
COMMENT ON COLUMN picture_book_projects.team_id IS '关联团队 ID';
COMMENT ON COLUMN picture_book_projects.user_id IS '创建者用户 ID';
COMMENT ON COLUMN picture_book_projects.title IS '绘本标题';
COMMENT ON COLUMN picture_book_projects.prompt IS '创作提示词，描述想要生成的绘本内容';
COMMENT ON COLUMN picture_book_projects.style IS '绘画风格（如"水彩"、"油画"、"儿童画"）';
COMMENT ON COLUMN picture_book_projects.page_count IS '页数，可选值：10（10页）、15（15页）、20（20页）';
COMMENT ON COLUMN picture_book_projects.status IS '项目状态，可选值：draft（草稿）、script_ready（脚本就绪）、assets_ready（素材就绪）、storyboard_ready（分镜就绪）、completed（已完成）、failed（失败）';
COMMENT ON COLUMN picture_book_projects.active_step IS '当前活跃步骤，可选值：script（脚本编写）、assets（素材生成）、storyboard（分镜排版）、preview（预览）';
COMMENT ON COLUMN picture_book_projects.cover_url IS '封面图 URL';
COMMENT ON COLUMN picture_book_projects.state IS '项目状态数据（JSONB），存储完整的脚本内容、角色设定、分镜排版等结构化数据，是项目运行时的核心数据载体';
COMMENT ON COLUMN picture_book_projects.draft_saved_at IS '最近一次草稿保存时间';
COMMENT ON COLUMN picture_book_projects.estimated_credits IS '预估积分消耗量';
COMMENT ON COLUMN picture_book_projects.actual_credits IS '实际积分消耗量';
COMMENT ON COLUMN picture_book_projects.is_deleted IS '是否已软删除';
COMMENT ON COLUMN picture_book_projects.deleted_at IS '软删除时间';
COMMENT ON COLUMN picture_book_projects.created_at IS '创建时间';
COMMENT ON COLUMN picture_book_projects.updated_at IS '最后更新时间';
COMMENT ON INDEX idx_picture_book_projects_workspace_updated IS '按工作空间查询项目列表，按更新时间倒序';
COMMENT ON INDEX idx_picture_book_projects_workspace_deleted IS '按工作空间查询未删除的项目，按更新时间倒序（软删除过滤）';
COMMENT ON INDEX idx_picture_book_projects_user_updated IS '按用户查询项目列表，按更新时间倒序'
  `.execute(db)

  await sql`
COMMENT ON TABLE picture_book_project_charges IS '绘本项目计费记录表 — 记录绘本各阶段的积分消耗';
COMMENT ON COLUMN picture_book_project_charges.id IS 'UUID 主键';
COMMENT ON COLUMN picture_book_project_charges.project_id IS '关联绘本项目 ID';
COMMENT ON COLUMN picture_book_project_charges.workspace_id IS '关联工作空间 ID';
COMMENT ON COLUMN picture_book_project_charges.team_id IS '关联团队 ID';
COMMENT ON COLUMN picture_book_project_charges.user_id IS '操作用户 ID（发起生成的用户）';
COMMENT ON COLUMN picture_book_project_charges.charge_type IS '计费类型，如 script（脚本生成）、image（图片生成）、audio（音频生成）';
COMMENT ON COLUMN picture_book_project_charges.model IS '使用的 AI 模型代码';
COMMENT ON COLUMN picture_book_project_charges.target_count IS '目标生成数量';
COMMENT ON COLUMN picture_book_project_charges.estimated_credits IS '预估积分消耗';
COMMENT ON COLUMN picture_book_project_charges.actual_credits IS '实际积分消耗，完成后填入';
COMMENT ON COLUMN picture_book_project_charges.status IS '处理状态，可选值：pending（待处理）、processing（处理中）、completed（已完成）、partial_failed（部分失败）、failed（全部失败）、refunded（已退款）';
COMMENT ON COLUMN picture_book_project_charges.batch_ids IS '关联的任务批次 ID 列表（JSONB 字符串数组）';
COMMENT ON COLUMN picture_book_project_charges.metadata IS '扩展元数据（JSONB）';
COMMENT ON COLUMN picture_book_project_charges.created_at IS '创建时间';
COMMENT ON COLUMN picture_book_project_charges.updated_at IS '最后更新时间';
COMMENT ON INDEX idx_picture_book_project_charges_project IS '按项目查询计费记录'
  `.execute(db)

  await sql`
COMMENT ON TABLE picture_book_project_assets IS '绘本项目素材表 — 存储绘本项目中的各类生成素材';
COMMENT ON COLUMN picture_book_project_assets.id IS 'UUID 主键';
COMMENT ON COLUMN picture_book_project_assets.project_id IS '关联绘本项目 ID';
COMMENT ON COLUMN picture_book_project_assets.kind IS '素材类型，可选值：character（角色图）、background（背景图）、page_image（页面插图）、page_audio_zh（中文配音）、page_audio_en（英文配音）';
COMMENT ON COLUMN picture_book_project_assets.ref_id IS '引用 ID，标识角色/背景/页面的唯一标识符（如 character-1、page-3）';
COMMENT ON COLUMN picture_book_project_assets.name IS '素材名称';
COMMENT ON COLUMN picture_book_project_assets.prompt IS '生成该素材时使用的提示词';
COMMENT ON COLUMN picture_book_project_assets.selected_asset_url IS '用户选中或系统选定的素材文件 URL';
COMMENT ON COLUMN picture_book_project_assets.selected_asset_id IS '选中素材在资产系统中的 ID';
COMMENT ON COLUMN picture_book_project_assets.batch_id IS '关联任务批次 ID';
COMMENT ON COLUMN picture_book_project_assets.status IS '处理状态，可选值：idle（未开始）、pending（待处理）、processing（处理中）、completed（已完成）、failed（失败）';
COMMENT ON COLUMN picture_book_project_assets.metadata IS '扩展元数据（JSONB）';
COMMENT ON COLUMN picture_book_project_assets.created_at IS '创建时间';
COMMENT ON COLUMN picture_book_project_assets.updated_at IS '最后更新时间';
COMMENT ON INDEX idx_picture_book_project_assets_project IS '按项目查询所有素材';
COMMENT ON INDEX idx_picture_book_project_assets_project_kind_ref IS '同一项目下素材类型与引用 ID 的唯一约束'
  `.execute(db)

  // ─── 短剧 ────────────────────────────────────────────────────────────

  await sql`
COMMENT ON TABLE short_drama_projects IS '短剧项目表 — 存储 AI 短剧创作项目';
COMMENT ON COLUMN short_drama_projects.id IS 'UUID 主键';
COMMENT ON COLUMN short_drama_projects.workspace_id IS '关联工作空间 ID';
COMMENT ON COLUMN short_drama_projects.team_id IS '关联团队 ID';
COMMENT ON COLUMN short_drama_projects.user_id IS '创建者用户 ID';
COMMENT ON COLUMN short_drama_projects.title IS '短剧标题';
COMMENT ON COLUMN short_drama_projects.prompt IS '创作提示词';
COMMENT ON COLUMN short_drama_projects.style IS '视觉风格（如"写实"、"动漫"、"水墨"）';
COMMENT ON COLUMN short_drama_projects.aspect_ratio IS '画面比例，常用值：9:16（竖屏短视频）、16:9（横屏视频）';
COMMENT ON COLUMN short_drama_projects.episode_count IS '总集数（范围 1~50）';
COMMENT ON COLUMN short_drama_projects.status IS '项目状态，可选值：draft（草稿）、summary_ready（摘要就绪）、outline_ready（大纲就绪）、assets_ready（素材就绪）、episodes_ready（剧集就绪）、completed（已完成）、failed（失败）';
COMMENT ON COLUMN short_drama_projects.active_step IS '当前活跃步骤，可选值：script（脚本编写）、assets（素材生成）、episodes（剧集生成）';
COMMENT ON COLUMN short_drama_projects.cover_url IS '封面图 URL';
COMMENT ON COLUMN short_drama_projects.state IS '项目状态数据（JSONB），存储完整的摘要、大纲、角色设定、各集分镜等结构化数据';
COMMENT ON COLUMN short_drama_projects.estimated_credits IS '预估积分消耗量';
COMMENT ON COLUMN short_drama_projects.actual_credits IS '实际积分消耗量';
COMMENT ON COLUMN short_drama_projects.draft_saved_at IS '最近一次草稿保存时间';
COMMENT ON COLUMN short_drama_projects.is_deleted IS '是否已软删除';
COMMENT ON COLUMN short_drama_projects.deleted_at IS '软删除时间';
COMMENT ON COLUMN short_drama_projects.created_at IS '创建时间';
COMMENT ON COLUMN short_drama_projects.updated_at IS '最后更新时间';
COMMENT ON INDEX idx_short_drama_projects_workspace_updated IS '按工作空间查询项目列表，按更新时间倒序';
COMMENT ON INDEX idx_short_drama_projects_workspace_deleted_updated IS '按工作空间查询未删除的项目，按更新时间倒序';
COMMENT ON INDEX idx_short_drama_projects_user_updated IS '按用户查询项目列表，按更新时间倒序'
  `.execute(db)

  await sql`
COMMENT ON TABLE short_drama_segments IS '短剧片段表 — 存储短剧项目中每集的各视频片段';
COMMENT ON COLUMN short_drama_segments.id IS 'UUID 主键';
COMMENT ON COLUMN short_drama_segments.project_id IS '关联短剧项目 ID';
COMMENT ON COLUMN short_drama_segments.episode_number IS '所属集数序号（从 1 开始）';
COMMENT ON COLUMN short_drama_segments.segment_id IS '片段唯一标识符（如 seg-1、seg-2）';
COMMENT ON COLUMN short_drama_segments.order_index IS '同一集内的排序序号（决定播放顺序）';
COMMENT ON COLUMN short_drama_segments.title IS '片段标题';
COMMENT ON COLUMN short_drama_segments.prompt IS '该片段的视频生成提示词';
COMMENT ON COLUMN short_drama_segments.mention_refs IS '@引用数据（JSONB），存储片段中引用的角色、场景等实体信息';
COMMENT ON COLUMN short_drama_segments.duration_seconds IS '片段时长（秒）';
COMMENT ON COLUMN short_drama_segments.status IS '处理状态，可选值：idle（未开始）、pending（待处理）、generating（生成中）、completed（已完成）、failed（失败）';
COMMENT ON COLUMN short_drama_segments.video_url IS '生成的视频文件 URL';
COMMENT ON COLUMN short_drama_segments.video_batch_id IS '视频生成关联的任务批次 ID';
COMMENT ON COLUMN short_drama_segments.video_task_id IS '视频生成关联的任务 ID';
COMMENT ON COLUMN short_drama_segments.created_at IS '创建时间';
COMMENT ON COLUMN short_drama_segments.updated_at IS '最后更新时间';
COMMENT ON INDEX idx_short_drama_segments_project_episode_order IS '按项目、集数和排序序号查询，用于获取某集的有序片段列表';
COMMENT ON INDEX idx_short_drama_segments_project_status IS '按项目和状态查询片段'
  `.execute(db)

  // ─── 安全与审计 ──────────────────────────────────────────────────────

  await sql`
COMMENT ON TABLE prompt_filter_logs IS '提示词过滤日志表 — 记录用户输入提示词的安全审核结果';
COMMENT ON COLUMN prompt_filter_logs.id IS 'UUID 主键';
COMMENT ON COLUMN prompt_filter_logs.user_id IS '发起请求的用户 ID';
COMMENT ON COLUMN prompt_filter_logs.prompt IS '被检查的原始提示词文本';
COMMENT ON COLUMN prompt_filter_logs.matched_rules IS '命中的过滤规则列表（JSONB 数组）';
COMMENT ON COLUMN prompt_filter_logs.action IS '处理结果，可选值：pass（放行）、rejected（拒绝）';
COMMENT ON COLUMN prompt_filter_logs.created_at IS '创建时间'
  `.execute(db)

  await sql`
COMMENT ON TABLE webhook_logs IS 'Webhook 回调日志表 — 记录外部 AI 服务的回调请求';
COMMENT ON COLUMN webhook_logs.id IS 'UUID 主键';
COMMENT ON COLUMN webhook_logs.provider IS '回调来源供应商代码';
COMMENT ON COLUMN webhook_logs.external_task_id IS '外部任务 ID，用于与提交的任务关联';
COMMENT ON COLUMN webhook_logs.payload IS '回调负载数据（JSONB），存储外部服务回调的完整请求体';
COMMENT ON COLUMN webhook_logs.signature_valid IS '回调签名是否验证通过';
COMMENT ON COLUMN webhook_logs.processed_at IS '回调处理时间';
COMMENT ON INDEX idx_webhook_ext_id IS '按外部任务 ID 查询回调日志'
  `.execute(db)

  await sql`
COMMENT ON TABLE payment_orders IS '支付订单表 — 记录用户积分充值和订阅购买订单';
COMMENT ON COLUMN payment_orders.id IS 'UUID 主键';
COMMENT ON COLUMN payment_orders.life_order_id IS '第三方支付平台订单号（唯一）';
COMMENT ON COLUMN payment_orders.user_id IS '支付用户 ID';
COMMENT ON COLUMN payment_orders.team_id IS '关联团队 ID（团队充值时填写，个人充值时为空）';
COMMENT ON COLUMN payment_orders.credit_account_id IS '关联积分账户 ID';
COMMENT ON COLUMN payment_orders.amount_fen IS '支付金额（单位：分），如 100 表示 1 元';
COMMENT ON COLUMN payment_orders.credits_to_grant IS '充值积分数';
COMMENT ON COLUMN payment_orders.status IS '订单状态，可选值：pending（待支付）、paid（已支付）、failed（支付失败）、refunded（已退款）';
COMMENT ON COLUMN payment_orders.order_type IS '订单类型，可选值：topup（积分充值）、subscription（订阅购买）';
COMMENT ON COLUMN payment_orders.platform_code IS '支付平台代码（如 life）';
COMMENT ON COLUMN payment_orders.callback_payload IS '支付回调数据（JSONB）';
COMMENT ON COLUMN payment_orders.created_at IS '订单创建时间';
COMMENT ON COLUMN payment_orders.paid_at IS '支付完成时间';
COMMENT ON INDEX idx_payment_orders_user IS '按用户和创建时间查询订单列表';
COMMENT ON INDEX idx_payment_orders_no IS '按订单号查询'
  `.execute(db)

  await sql`
COMMENT ON TABLE provider_api_logs IS '供应商 API 调用日志表 — 记录所有调用外部 AI 供应商 API 的请求与响应';
COMMENT ON COLUMN provider_api_logs.id IS 'UUID 主键';
COMMENT ON COLUMN provider_api_logs.batch_id IS '关联任务批次 ID';
COMMENT ON COLUMN provider_api_logs.task_id IS '关联任务 ID';
COMMENT ON COLUMN provider_api_logs.user_id IS '请求用户 ID';
COMMENT ON COLUMN provider_api_logs.team_id IS '关联团队 ID';
COMMENT ON COLUMN provider_api_logs.workspace_id IS '关联工作空间 ID';
COMMENT ON COLUMN provider_api_logs.module IS '功能模块代码（如 music、video、image）';
COMMENT ON COLUMN provider_api_logs.provider IS '供应商代码（如 volcengine、gemini）';
COMMENT ON COLUMN provider_api_logs.model IS '使用的模型代码';
COMMENT ON COLUMN provider_api_logs.operation IS '操作类型（如 create_task=创建任务、get_result=获取结果）';
COMMENT ON COLUMN provider_api_logs.method IS 'HTTP 请求方法（GET/POST/PUT 等）';
COMMENT ON COLUMN provider_api_logs.endpoint IS 'API 端点路径';
COMMENT ON COLUMN provider_api_logs.request_url IS '完整请求 URL';
COMMENT ON COLUMN provider_api_logs.referer IS '请求来源页面 URL';
COMMENT ON COLUMN provider_api_logs.request_payload IS '请求负载数据（JSONB）';
COMMENT ON COLUMN provider_api_logs.request_truncated IS '请求负载是否因过长被截断';
COMMENT ON COLUMN provider_api_logs.response_status IS 'HTTP 响应状态码';
COMMENT ON COLUMN provider_api_logs.response_payload IS '响应负载数据（JSONB）';
COMMENT ON COLUMN provider_api_logs.response_truncated IS '响应负载是否因过长被截断';
COMMENT ON COLUMN provider_api_logs.external_task_id IS '外部任务 ID';
COMMENT ON COLUMN provider_api_logs.duration_ms IS '请求耗时（毫秒）';
COMMENT ON COLUMN provider_api_logs.status IS '调用状态，可选值：success（成功）、failed（失败）';
COMMENT ON COLUMN provider_api_logs.error_message IS '失败时的错误信息';
COMMENT ON COLUMN provider_api_logs.created_at IS '创建时间';
COMMENT ON INDEX idx_provider_api_logs_batch_created IS '按批次和创建时间查询调用日志';
COMMENT ON INDEX idx_provider_api_logs_task_created IS '按任务和创建时间查询调用日志';
COMMENT ON INDEX idx_provider_api_logs_provider_operation IS '按供应商、操作类型和创建时间查询调用日志'
  `.execute(db)

  // ─── 系统配置 ────────────────────────────────────────────────────────

  await sql`
COMMENT ON TABLE system_cost_configs IS '系统成本配置表 — 定义各功能模块的积分消耗标准';
COMMENT ON COLUMN system_cost_configs.key IS '配置键（主键），如 music_voice_clone（音色克隆）、music_song（歌曲生成）、picture_book_page（绘本页）';
COMMENT ON COLUMN system_cost_configs.label IS '显示名称（中文）';
COMMENT ON COLUMN system_cost_configs.description IS '配置说明，描述该成本项的计费规则';
COMMENT ON COLUMN system_cost_configs.credit_cost IS '积分消耗量（必须 >= 0）';
COMMENT ON COLUMN system_cost_configs.updated_at IS '最后更新时间'
  `.execute(db)

  // ─── 错误记录 ────────────────────────────────────────────────────────

  await sql`
COMMENT ON TABLE ai_assistant_errors IS 'AI 助手错误记录表 — 记录 AI 助手功能调用失败的信息';
COMMENT ON COLUMN ai_assistant_errors.id IS 'UUID 主键';
COMMENT ON COLUMN ai_assistant_errors.user_id IS '发起请求的用户 ID';
COMMENT ON COLUMN ai_assistant_errors.http_status IS 'HTTP 状态码';
COMMENT ON COLUMN ai_assistant_errors.error_detail IS '错误详情信息';
COMMENT ON COLUMN ai_assistant_errors.created_at IS '创建时间'
  `.execute(db)

  await sql`
COMMENT ON TABLE submission_errors IS '提交错误记录表 — 记录用户提交内容时的错误信息';
COMMENT ON COLUMN submission_errors.id IS 'UUID 主键';
COMMENT ON COLUMN submission_errors.user_id IS '发起请求的用户 ID';
COMMENT ON COLUMN submission_errors.source IS '错误来源，可选值：generate_api（生成 API 端上报）、client（客户端上报）';
COMMENT ON COLUMN submission_errors.error_code IS '错误代码';
COMMENT ON COLUMN submission_errors.http_status IS 'HTTP 状态码';
COMMENT ON COLUMN submission_errors.detail IS '错误详情信息';
COMMENT ON COLUMN submission_errors.model IS '相关的 AI 模型代码';
COMMENT ON COLUMN submission_errors.canvas_id IS '关联的画布 ID';
COMMENT ON COLUMN submission_errors.created_at IS '创建时间'
  `.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  // PostgreSQL 不支持批量删除 COMMENT，逐表清除
  const tables = [
    'users',
    'subscription_plans',
    'user_subscriptions',
    'refresh_tokens',
    'email_verifications',
    'teams',
    'team_members',
    'team_subscriptions',
    'workspaces',
    'workspace_members',
    'credit_accounts',
    'credits_ledger',
    'task_batches',
    'tasks',
    'assets',
    'providers',
    'provider_models',
    'provider_system_voices',
    'team_model_configs',
    'voice_profiles',
    'prompt_filter_rules',
    'canvases',
    'canvas_node_outputs',
    'canvas_agent_sessions',
    'video_studio_projects',
    'music_voice_clones',
    'music_tracks',
    'picture_book_projects',
    'picture_book_project_charges',
    'picture_book_project_assets',
    'short_drama_projects',
    'short_drama_segments',
    'prompt_filter_logs',
    'webhook_logs',
    'payment_orders',
    'provider_api_logs',
    'system_cost_configs',
    'ai_assistant_errors',
    'submission_errors',
  ]

  for (const table of tables) {
    await sql`COMMENT ON TABLE ${sql.ref(table)} IS NULL`.execute(db)
    // 列注释也需要清除，但 COMMENT ON TABLE IS NULL 不会级联删除列注释
    // 这里暂时只清除表级别注释，列注释在表重建时自动清除
  }
}
