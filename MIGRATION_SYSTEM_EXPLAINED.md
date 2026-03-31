# 数据库迁移系统详解

## 为什么执行迁移可以创建所有表？

### 简单回答
迁移文件中包含了创建表的 SQL 代码，执行迁移就是执行这些 SQL 代码。

---

## 迁移系统工作原理

### 1. 迁移脚本入口

**文件**: `packages/db/scripts/migrate.ts`

```typescript
async function main() {
  const db = getDb()  // 连接数据库

  // 创建迁移器
  const migrator = new Migrator({
    db,
    provider: new SafeFileMigrationProvider(
      path.join(__dirname, '../migrations'),  // 迁移文件目录
    ),
  })

  // 执行所有未执行的迁移
  const { error, results } = await migrator.migrateToLatest()

  // 输出结果
  results?.forEach((result) => {
    if (result.status === 'Success') {
      console.log(`  Migration "${result.migrationName}" applied`)
    }
  })
}
```

**关键步骤**:
1. 连接数据库
2. 读取 `migrations/` 目录下的所有迁移文件
3. 按文件名排序（001, 002, 003...）
4. 执行每个迁移文件的 `up()` 函数
5. 记录已执行的迁移到 `kysely_migration` 表

---

### 2. 迁移文件结构

每个迁移文件都有两个函数：

```typescript
// 001_users.ts
import type { Kysely } from 'kysely'
import { sql } from 'kysely'

// ✅ up() 函数：创建表、添加字段等
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('users')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('email', 'varchar(255)', (col) => col.unique().notNull())
    .addColumn('username', 'varchar(100)', (col) => col.unique().notNull())
    .addColumn('password_hash', 'varchar(255)', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.defaultTo(sql`NOW()`))
    .execute()
}

// ❌ down() 函数：回滚操作（删除表）
export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('users').execute()
}
```

**说明**:
- `up()`: 向前迁移，创建表、添加字段
- `down()`: 向后回滚，删除表、删除字段
- 执行迁移时只调用 `up()` 函数

---

### 3. 迁移文件转换为 SQL

Kysely 会将 TypeScript 代码转换为 SQL：

```typescript
// TypeScript 代码
await db.schema
  .createTable('users')
  .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
  .addColumn('email', 'varchar(255)', (col) => col.unique().notNull())
  .execute()
```

**转换为 SQL**:
```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL
);
```

---

### 4. 迁移跟踪表

Kysely 自动创建 `kysely_migration` 表来跟踪已执行的迁移：

```sql
CREATE TABLE kysely_migration (
  name VARCHAR(255) PRIMARY KEY,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**示例数据**:
```sql
SELECT * FROM kysely_migration ORDER BY timestamp;

         name          |        timestamp
-----------------------+-------------------------
 001_users             | 2024-03-11 10:00:00+00
 002_subscription_plans| 2024-03-11 10:00:01+00
 003_auth_tables       | 2024-03-11 10:00:02+00
 004_teams             | 2024-03-11 10:00:03+00
 005_credits           | 2024-03-11 10:00:04+00
 006_tasks             | 2024-03-11 10:00:05+00
 ...
```

---

### 5. 迁移执行流程

```
┌─────────────────────────────────────────────────────────────┐
│ 1. 读取 migrations/ 目录                                     │
│    - 001_users.ts                                            │
│    - 002_subscription_plans.ts                               │
│    - 003_auth_tables.ts                                      │
│    - ...                                                     │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ 2. 检查 kysely_migration 表                                  │
│    - 查询已执行的迁移                                         │
│    - 找出未执行的迁移                                         │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ 3. 按顺序执行未执行的迁移                                     │
│    - 执行 001_users.up(db)                                   │
│      → CREATE TABLE users (...)                             │
│    - 记录到 kysely_migration                                 │
│    - 执行 002_subscription_plans.up(db)                      │
│      → CREATE TABLE subscription_plans (...)                │
│    - 记录到 kysely_migration                                 │
│    - ...                                                     │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ 4. 所有表创建完成                                            │
│    ✅ users                                                  │
│    ✅ subscription_plans                                     │
│    ✅ refresh_tokens                                         │
│    ✅ teams                                                  │
│    ✅ workspaces                                             │
│    ✅ credit_accounts                                        │
│    ✅ task_batches                                           │
│    ✅ tasks                                                  │
│    ✅ assets                                                 │
│    ✅ ...                                                    │
└─────────────────────────────────────────────────────────────┘
```

---

## 具体示例：创建 users 表

### 迁移文件: 001_users.ts

```typescript
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('users')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`)
    )
    .addColumn('email', 'varchar(255)', (col) => col.unique().notNull())
    .addColumn('username', 'varchar(100)', (col) => col.unique().notNull())
    .addColumn('password_hash', 'varchar(255)', (col) => col.notNull())
    .addColumn('avatar_url', 'text')
    .addColumn('role', 'varchar(20)', (col) => col.defaultTo('member'))
    .addColumn('status', 'varchar(20)', (col) => col.defaultTo('active'))
    .addColumn('plan_tier', 'varchar(20)', (col) => col.defaultTo('free'))
    .addColumn('created_at', 'timestamptz', (col) => col.defaultTo(sql`NOW()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.defaultTo(sql`NOW()`))
    .execute()

  await sql`ALTER TABLE users ADD CONSTRAINT chk_users_role CHECK (role IN ('admin','member'))`.execute(db)
  await sql`ALTER TABLE users ADD CONSTRAINT chk_users_status CHECK (status IN ('active','suspended','deleted'))`.execute(db)
  await sql`ALTER TABLE users ADD CONSTRAINT chk_users_plan_tier CHECK (plan_tier IN ('free','basic','pro','enterprise'))`.execute(db)
}
```

### 生成的 SQL

```sql
-- 创建 users 表
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  username VARCHAR(100) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  avatar_url TEXT,
  role VARCHAR(20) DEFAULT 'member',
  status VARCHAR(20) DEFAULT 'active',
  plan_tier VARCHAR(20) DEFAULT 'free',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 添加约束
ALTER TABLE users ADD CONSTRAINT chk_users_role
  CHECK (role IN ('admin','member'));

ALTER TABLE users ADD CONSTRAINT chk_users_status
  CHECK (status IN ('active','suspended','deleted'));

ALTER TABLE users ADD CONSTRAINT chk_users_plan_tier
  CHECK (plan_tier IN ('free','basic','pro','enterprise'));
```

---

## 具体示例：创建 task_batches 表

### 迁移文件: 006_tasks.ts

```typescript
export async function up(db: Kysely<unknown>): Promise<void> {
  // 创建 task_batches 表
  await db.schema
    .createTable('task_batches')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('user_id', 'uuid', (col) => col.notNull().references('users.id'))
    .addColumn('team_id', 'uuid', (col) => col.references('teams.id'))
    .addColumn('workspace_id', 'uuid', (col) => col.references('workspaces.id'))
    .addColumn('idempotency_key', 'varchar(64)', (col) => col.unique().notNull())
    .addColumn('module', 'varchar(20)', (col) => col.notNull())
    .addColumn('provider', 'varchar(50)', (col) => col.notNull())
    .addColumn('model', 'varchar(100)', (col) => col.notNull())
    .addColumn('prompt', 'text', (col) => col.notNull())
    .addColumn('params', 'jsonb', (col) => col.notNull().defaultTo('{}'))
    .addColumn('status', 'varchar(20)', (col) => col.notNull().defaultTo('pending'))
    .addColumn('created_at', 'timestamptz', (col) => col.defaultTo(sql`NOW()`))
    .execute()

  // 添加约束
  await sql`ALTER TABLE task_batches ADD CONSTRAINT chk_tb_module
    CHECK (module IN ('image','video','tts','lipsync','agent'))`.execute(db)

  // 创建索引
  await db.schema
    .createIndex('idx_batches_user')
    .on('task_batches')
    .columns(['user_id', 'created_at'])
    .execute()
}
```

### 生成的 SQL

```sql
-- 创建表
CREATE TABLE task_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  team_id UUID REFERENCES teams(id),
  workspace_id UUID REFERENCES workspaces(id),
  idempotency_key VARCHAR(64) UNIQUE NOT NULL,
  module VARCHAR(20) NOT NULL,
  provider VARCHAR(50) NOT NULL,
  model VARCHAR(100) NOT NULL,
  prompt TEXT NOT NULL,
  params JSONB NOT NULL DEFAULT '{}',
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 添加约束
ALTER TABLE task_batches ADD CONSTRAINT chk_tb_module
  CHECK (module IN ('image','video','tts','lipsync','agent'));

-- 创建索引
CREATE INDEX idx_batches_user ON task_batches (user_id, created_at);
```

---

## 迁移的幂等性

### 什么是幂等性？
多次执行相同的操作，结果相同。

### 迁移如何实现幂等性？

```typescript
// migrate.ts 中的逻辑
const { error, results } = await migrator.migrateToLatest()

// migrateToLatest() 内部逻辑：
// 1. 查询 kysely_migration 表
SELECT name FROM kysely_migration;

// 2. 对比 migrations/ 目录中的文件
// 已执行: 001_users, 002_subscription_plans
// 未执行: 003_auth_tables, 004_teams, ...

// 3. 只执行未执行的迁移
// ✅ 执行 003_auth_tables.up()
// ✅ 执行 004_teams.up()
// ✅ 执行 005_credits.up()
// ...

// 4. 记录到 kysely_migration
INSERT INTO kysely_migration (name, timestamp) VALUES
  ('003_auth_tables', NOW()),
  ('004_teams', NOW()),
  ('005_credits', NOW());
```

**结果**:
- 第一次执行：创建所有表
- 第二次执行：什么都不做（所有迁移已执行）
- 添加新迁移后执行：只执行新的迁移

---

## 所有迁移文件创建的表

### 完整表列表

| 迁移文件 | 创建的表 | 说明 |
|---------|---------|------|
| 001_users.ts | users | 用户表 |
| 002_subscription_plans.ts | subscription_plans | 订阅计划表 |
| 003_auth_tables.ts | refresh_tokens, login_logs | 认证相关表 |
| 004_teams.ts | teams, workspaces | 团队和工作区表 |
| 005_credits.ts | credit_accounts, credits_ledger, team_members | 积分系统表 |
| 006_tasks.ts | task_batches, tasks, assets | 任务和资产表 |
| 007_security.ts | prompt_filters | 提示词过滤表 |
| 008_providers.ts | providers, provider_models | 提供商和模型表 |
| 009_workspace_members.ts | workspace_members | 工作区成员表 |
| 010_quota_period.ts | - | 添加配额周期字段 |
| 011_team_type.ts | - | 添加团队类型字段 |
| 012_soft_delete.ts | - | 添加软删除字段 |
| 013_video_thumbnail.ts | - | 添加视频缩略图字段 |
| 014_phone_login.ts | - | 添加手机号登录字段 |
| 015_drop_username_unique.ts | - | 移除用户名唯一约束 |

**总计**: 15 个迁移文件，创建 **14 张表**

---

## 查看数据库中的所有表

### 连接数据库
```bash
psql -U aigc -d aigc_prod -h localhost
```

### 查看所有表
```sql
\dt

-- 或
SELECT tablename FROM pg_tables WHERE schemaname = 'public';
```

### 预期输出
```
              List of relations
 Schema |        Name         | Type  | Owner
--------+---------------------+-------+-------
 public | assets              | table | aigc
 public | credit_accounts     | table | aigc
 public | credits_ledger      | table | aigc
 public | kysely_migration    | table | aigc
 public | login_logs          | table | aigc
 public | prompt_filters      | table | aigc
 public | provider_models     | table | aigc
 public | providers           | table | aigc
 public | refresh_tokens      | table | aigc
 public | subscription_plans  | table | aigc
 public | task_batches        | table | aigc
 public | tasks               | table | aigc
 public | team_members        | table | aigc
 public | teams               | table | aigc
 public | users               | table | aigc
 public | workspace_members   | table | aigc
 public | workspaces          | table | aigc
(17 rows)
```

---

## 手动执行迁移

### 方法 1: 使用 pnpm 脚本
```bash
cd /opt/aigc
source .env
pnpm --filter @aigc/db migrate
```

### 方法 2: 直接运行 TypeScript
```bash
cd /opt/aigc/packages/db
tsx scripts/migrate.ts
```

### 方法 3: 查看生成的 SQL（不执行）
```bash
# 修改 migrate.ts，添加 SQL 日志
const migrator = new Migrator({
  db,
  provider: new SafeFileMigrationProvider(...),
  // 添加这一行
  allowUnorderedMigrations: true,
})

// 或者直接查看迁移文件，手动转换为 SQL
```

---

## 回滚迁移

### 回滚最后一个迁移
```typescript
// 修改 migrate.ts
const { error, results } = await migrator.migrateDown()
```

### 回滚到特定迁移
```typescript
const { error, results } = await migrator.migrateTo('005_credits')
```

### 回滚所有迁移（危险！）
```typescript
const { error, results } = await migrator.migrateTo(NO_MIGRATIONS)
```

---

## 总结

### 为什么执行迁移可以创建所有表？

1. **迁移文件包含创建表的代码**
   - 每个 `.ts` 文件的 `up()` 函数包含 `CREATE TABLE` 逻辑

2. **迁移系统按顺序执行**
   - 001 → 002 → 003 → ... → 015
   - 确保依赖关系正确（如外键）

3. **Kysely 转换为 SQL**
   - TypeScript 代码 → SQL 语句
   - 自动执行 SQL

4. **跟踪已执行的迁移**
   - `kysely_migration` 表记录
   - 实现幂等性

5. **一次性创建所有表**
   - 第一次执行：创建 14 张表
   - 后续执行：只执行新的迁移

### 类比理解

迁移系统就像一个**建筑施工队**：

- **迁移文件** = 施工图纸（001_地基.ts, 002_框架.ts, 003_墙壁.ts）
- **migrate.ts** = 施工队长（按图纸顺序施工）
- **kysely_migration** = 施工日志（记录已完成的工作）
- **up() 函数** = 施工步骤（挖地基、搭框架、砌墙）
- **数据库表** = 建筑物（users 表、tasks 表、assets 表）

执行迁移 = 施工队长按图纸顺序施工，最终建成完整的建筑物（数据库）。
