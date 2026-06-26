# AGENTS.md 常见问题与解决方案 SOP 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 AGENTS.md 建立项目级「问题沉淀规则」与「常见问题与解决方案」章节，并以 AGENTS.md 为唯一权威源，把根目录 CLAUDE.md 降级为引导文件，使任何同事、任何环境、任何 Agent 都能读到同一份规范与历史解决方案。

**Architecture:** 文档单一权威源策略 —— 所有项目约定、工作流程、规则、常见问题只写在 AGENTS.md；根目录 CLAUDE.md 仅保留指向 AGENTS.md 的一句话引导并删除与 AGENTS.md 重复的全部正文，消除三文件分歧；`.claude/CLAUDE.md`（Claude Code 工具层配置）不动；失效的 `~/.claude/CLAUDE.md` 全局引用改为指向项目内 AGENTS.md。

**Tech Stack:** Markdown（无代码改动，无测试）。

**关联 spec：** `docs/superpowers/specs/2026-06-26-agents-faq-sop-design.md`

---

## Files

- Modify: `AGENTS.md`（唯一权威源）
  - 第 5-6 行工作流程章节：新增「问题沉淀规则」+ 改全局引用
  - 第 155 行后（「注意事项」与「Docker 部署」之间）：新增「常见问题与解决方案」章节
- Modify: `CLAUDE.md`（根目录，降级为引导文件，全文重写）
- 不改: `.claude/CLAUDE.md`

---

## Task 1: AGENTS.md 工作流程章节 —— 新增问题沉淀规则 + 修正全局引用

**Files:**
- Modify: `AGENTS.md:5-6`

- [ ] **Step 1: 修正失效的全局引用**

将第 6 行：
```
首先需要 加载全局的规则 ~/.claude/CLAUDE.md
```
改为：
```
首先需要加载项目内的约定文件 `AGENTS.md`（本项目所有约定、规则、常见问题以本文件为唯一权威源）。
```

> 原因：`~/.claude/CLAUDE.md` 是用户私有全局文件，新同事/新环境不存在，等于空指向。改为指向项目内 AGENTS.md。

- [ ] **Step 2: 在工作流程章节追加问题沉淀规则**

在「## 工作流程（非常重要）」章节下（第 6 行下方、`## 项目概述` 上方）插入：

```markdown
### 问题沉淀规则

同一个**技术性报错 / bug**、**环境 / 配置 / 部署问题**、**第三方集成踩坑**（火山、TOS、Redis、PostgreSQL、Kysely、业管平台等），在本项目内出现第 **2 次**时，必须把解决办法按四段式写入本文件「[常见问题与解决方案](#常见问题与解决方案)」章节：

- **问题现象**：可被搜索到的报错关键字或可观察症状（如错误码、报错文案片段）。
- **根本原因**：写"为什么发生"，根因而非表象。
- **解决办法**：关键命令 / 配置取值 / 代码改动方向，不贴大段代码。
- **验证方式**：可执行的确认手段（如 `docker logs`、某条 SQL、重启后观察指标）。

业务逻辑理解问题（计费规则、状态流转等）不进此章节，走业务说明文档（如 `A豆积分体系说明.md`）。每条控制在 8-15 行内。
```

- [ ] **Step 3: 检查渲染并提交**

Run: 用 Markdown 预览确认锚点 `#常见问题与解决方案` 可跳转（章节会在 Task 2 创建）。

```bash
git add AGENTS.md
git commit -m "docs(agents): 工作流程新增问题沉淀规则，修正失效的全局引用"
```

---

## Task 2: AGENTS.md 新增「常见问题与解决方案」章节

**Files:**
- Modify: `AGENTS.md`（在第 155 行 `- **本地验证边界**...` 之后、第 157 行 `---` 之前插入新章节）

- [ ] **Step 1: 在「注意事项」与「Docker 部署」之间插入新章节**

在 `- **本地验证边界**...` 这一行之后、`---`（分隔线）之前，插入完整的「常见问题与解决方案」章节。完整内容如下（四个四段式条目）：

```markdown
## 常见问题与解决方案

> 本章节记录项目中反复出现的技术 / 环境 / 第三方集成问题及其解决办法。新增条目请遵循「[问题沉淀规则](#问题沉淀规则)」的四段式。

### 1. 业管平台 A 豆迁移反复返工（余额落本地 / fire-and-forget / toby_ 前缀）

- **问题现象**：A 豆余额、累计消费、累计获得被写进本地表；通知业管的接口在主事务后只做一次同步调用就返回；新增了 `toby_` 前缀的本地业管表。导致余额对账不一致、通知丢失、命名与项目内 Toby 业务模块混淆。
- **根本原因**：把业管的权威数据当成本地缓存维护；把"需要可靠投递的外部通知"当成普通 HTTP 调用；复用了与已有业务模块冲突的命名前缀。
- **解决办法**：
  1. **A 豆不落本地**：余额 / 累计消费 / 累计获得一律实时从业管按当前选中 `biz_mgmt_user_id` 查询；`MEMBER-1001` 返回的 `pointsNum/sumPointsNum/consumePointsNum` 不落库；本地只记 `biz_mgmt_a_bean_transactions` 扣减审计。
  2. **通知走 outbox**：所有"本地状态变化需通知业管"的动作，先在业务事务内写 `biz_mgmt_outbox_events(status='pending')`，事务提交后投 `biz-mgmt-notify-queue`，worker 消费按指数退避重试，超限标 `failed` 并保留记录，禁止 fire-and-forget。
  3. **命名前缀**：本地业管表统一用 `biz_mgmt_` 前缀，禁止 `toby_`（`toby` 仅保留在外部接口协议层封装）。
- **验证方式**：`grep -rni "credit_accounts\|credits_ledger" apps/api/src/routes apps/worker/src` 确认新生成链路不再写本地积分表；查 `biz_mgmt_outbox_events` 有 `succeeded`/`failed` 记录而非空表；`grep -rn "toby_" packages/db/migrations` 无新增 `toby_` 业管表。

### 2. PostgreSQL 流水表查询触发 53200 OOM

- **问题现象**：基础设施服务器上查询 `credits_ledger` 等大流水表时，PostgreSQL 报错 `ERROR: out of memory / SQLSTATE 53200`，连接中断，严重时 PG 进程被 OOM Killer 杀掉。
- **根本原因**：PG 默认 `shared_buffers=128MB / work_mem=4MB` 在大流水表上做大查询/排序/哈希聚合时，按连接数倍增的 work_mem 把内存撑爆；宿主机又没配 swap，内存峰值无缓冲。
- **解决办法**：
  1. `deploy/infra/docker-compose.yml` 已用 `command:` 覆盖内存参数，8GB 服务器默认档位：`shared_buffers=1GB / work_mem=16MB / effective_cache_size=3GB / max_connections=80`，经 `deploy/infra/.env` 的 `PG_*` 变量注入。改 `.env` 后必须 `docker compose up -d --force-recreate`。
  2. 宿主机首次执行 `deploy/infra/setup-host.sh` 创建 2GB swap + `vm.swappiness=10`（幂等，仅宿主机内核层，容器内不能做 swap）。
- **验证方式**：`docker exec <pg容器> psql -U aigc -d aigc_dev -c "SHOW shared_buffers; SHOW work_mem;"` 确认参数已生效；`free -h`（宿主机）确认 swap 存在；重跑触发过 OOM 的查询不再报 53200。

### 3. Sharp 原生模块 Windows 编译的二进制无法在 Linux 容器运行

- **问题现象**：Windows 本机 `pnpm install` 编译出的 `sharp` 原生二进制，打进 Docker（Alpine）镜像后启动报模块加载失败 / `node_modules/sharp` 平台不匹配。
- **根本原因**：Sharp 含平台相关的原生 `.node` 二进制，本机编译的目标平台与 Alpine/musl 容器环境不一致，无法跨平台复用。
- **解决办法**：Dockerfile 已在 Alpine 环境内重新安装 sharp（构建阶段 `pnpm rebuild sharp` 或重装），无需在本机手动处理。**不要**把 Windows 本机的 `node_modules/sharp` 原样拷进镜像。
- **验证方式**：`docker run --rm <aigc-web镜像> node -e "require('sharp')"` 不报错即说明镜像内 sharp 可用。

### 4. NEXT_PUBLIC_STORAGE_HOST 误填内网地址导致客户端图片 / 资源 404

- **问题现象**：浏览器端图片、视频、数字人资产加载失败（404 或连接超时），但服务端日志正常、对象存储里文件确实存在。
- **根本原因**：`NEXT_PUBLIC_STORAGE_HOST`（火山 TOS 公网域名）会被**打包进客户端 bundle**。若填成内网地址（如 `INFRA_HOST` 内网 IP），浏览器（用户网络）无法访问内网，于是 404；而服务端能访问是因为服务器在内网。
- **解决办法**：`.env` 中 `NEXT_PUBLIC_STORAGE_HOST` 必须填写**浏览器可访问的火山 TOS 公网域名**（如 `xxx.tos-cn-shanghai.volces.com`），不能用内网地址。**改后必须重新构建 web 镜像**（因为已打进 bundle）。
- **验证方式**：改 `.env` 后 `docker compose up -d --force-recreate` 重建 web 容器，浏览器开发者工具看图片请求 URL 指向公网域名且返回 200。
```

- [ ] **Step 2: 提交**

```bash
git add AGENTS.md
git commit -m "docs(agents): 新增「常见问题与解决方案」章节（4 个四段式条目）"
```

---

## Task 3: 根目录 CLAUDE.md 降级为引导文件

**Files:**
- Modify: `CLAUDE.md`（全文重写）

- [ ] **Step 1: 用引导文件覆盖 CLAUDE.md**

将 `CLAUDE.md` 全文替换为以下内容（删除所有与 AGENTS.md 重复的正文）：

```markdown
# CLAUDE.md

> 本项目所有约定、规则、命令、架构、注意事项、常见问题以 **`AGENTS.md`** 为唯一权威源。
> Claude Code 在此项目工作时，**请先读 `AGENTS.md`**，不要依赖本文件的重复内容。

## Claude Code 专属配置

- **工具层配置**（CodeGraph MCP、Playwright 自动登录）见 `.claude/CLAUDE.md`。
- Claude Code 工作流遵循 `AGENTS.md` 的「工作流程（非常重要）」「注意事项」「常见问题与解决方案」章节。

## Agents 规则

- 上下文剩余容量低于 20% 时，自动使用 `/compact` 命令压缩上下文。
- 同一技术 / 环境 / 第三方集成问题重复出现时，按 `AGENTS.md`「问题沉淀规则」的四段式沉淀进 AGENTS.md「常见问题与解决方案」章节。
- 若某类流程反复出现，不要再继续堆到 `CLAUDE.md`，优先升级为独立 skill、hook 或子代理。
```

- [ ] **Step 2: 提交**

```bash
git add CLAUDE.md
git commit -m "docs(claude): CLAUDE.md 降级为引导文件，以 AGENTS.md 为唯一权威源"
```

---

## Task 4: 验证三文件一致性

**Files:** 无改动，仅校验。

- [ ] **Step 1: 校验 AGENTS.md 内容完整**

Run: 打开 `AGENTS.md`，确认：
1. 第 5-6 行工作流程章节含「问题沉淀规则」小节，且第 6 行指向项目内 AGENTS.md（不再是 `~/.claude/CLAUDE.md`）。
2. 「注意事项」与「Docker 部署」之间存在「常见问题与解决方案」章节，含 4 个 `### N.` 条目，每条都有 现象/原因/解法/验证 四段。
3. Docker 部署章节的 PG OOM / Sharp / STORAGE_HOST 原散落注意事项**仍在**（未删）。

Expected: 三点全部满足。

- [ ] **Step 2: 校验 CLAUDE.md 不再有重复正文**

Run: 打开 `CLAUDE.md`，确认：
1. 不再包含「项目概述」「常用命令」「Monorepo 架构」「技术栈关键点」「环境变量」「Docker 部署」等与 AGENTS.md 重复的章节。
2. 顶部明确声明以 AGENTS.md 为唯一权威源。
3. 第 6 行不再写 `~/.claude/CLAUDE.md`。

Expected: 三点全部满足。

- [ ] **Step 3: 确认 .claude/CLAUDE.md 未被改动**

Run: `git diff HEAD --stat -- .claude/CLAUDE.md`
Expected: 无输出（该文件未改动）。

- [ ] **Step 4: 最终提交（如有遗漏修正）**

```bash
git status   # 确认只剩本次文档改动
git log --oneline -5   # 确认 3 条文档提交在列
```

---

## Self Review

- **Spec coverage**：
  - spec 3.1（AGENTS.md 唯一源 + 其余引导）→ Task 1+2 写 AGENTS.md，Task 3 把 CLAUDE.md 降级为引导，Task 4 校验。覆盖。
  - spec 3.2（问题沉淀规则）→ Task 1 Step 2。覆盖。
  - spec 3.3（失效全局引用）→ Task 1 Step 1（AGENTS.md）+ Task 3（CLAUDE.md 随重写一并修正）。覆盖。
  - spec 3.4（四段式章节）→ Task 2。覆盖。
  - spec 3.5（4 个高频问题）→ Task 2 含 4 个完整四段式条目。覆盖。
- **Placeholder scan**：无 TBD/TODO；四段式条目均为完整正文，含具体配置值、命令、grep 验证语句。
- **Type consistency**：章节锚点 `#常见问题与解决方案`、`#问题沉淀规则` 在 Task 1 与 Task 2 中一致；CLAUDE.md 引导措辞与 spec 3.1 一致。
- **YAGNI**：不新建独立 troubleshooting 文件、不按模块拆分、不重写 Docker 章节正文、不改 `.claude/CLAUDE.md`。
