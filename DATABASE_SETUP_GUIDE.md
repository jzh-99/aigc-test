# 新服务器数据库搭建指南

## setup.sh 数据库搭建流程

### 1. 安装 PostgreSQL

**脚本位置**: setup.sh 第 88-96 行

```bash
# 检查是否已安装 PostgreSQL
if ! command -v psql &>/dev/null; then
  # 安装 PostgreSQL 和客户端
  apt-get install -y -q postgresql postgresql-client
fi
```

**说明**:
- 使用 apt 包管理器安装
- 安装 `postgresql` 服务端和 `postgresql-client` 客户端
- Ubuntu 22.04 默认安装 PostgreSQL 14

---

### 2. 启动 PostgreSQL 服务

**脚本位置**: setup.sh 第 98-112 行

```bash
# 检测 PostgreSQL 是否在运行
if ! pg_isready -q 2>/dev/null; then
  # 获取 PostgreSQL 版本和集群名称
  PG_VER=$(pg_lsclusters -h 2>/dev/null | head -1 | awk '{print $1}')
  PG_CLU=$(pg_lsclusters -h 2>/dev/null | head -1 | awk '{print $2}')

  # 启动 PostgreSQL
  if [ -n "$PG_VER" ] && [ -n "$PG_CLU" ]; then
    pg_ctlcluster "$PG_VER" "$PG_CLU" start
  else
    service postgresql start
  fi

  sleep 2
fi
```

**说明**:
- 使用 `pg_isready` 检查服务状态
- 优先使用 `pg_ctlcluster` 启动（更可靠）
- 备用方案使用 `service postgresql start`

---

### 3. 创建数据库用户

**脚本位置**: setup.sh 第 116-117 行

```bash
# 检查用户是否存在，不存在则创建
su - postgres -c "psql -tc \"SELECT 1 FROM pg_user WHERE usename='aigc'\"" | grep -q 1 || \
  su - postgres -c "psql -c \"CREATE USER aigc WITH PASSWORD 'aigcpass';\""
```

**等价 SQL 语句**:
```sql
-- 检查用户是否存在
SELECT 1 FROM pg_user WHERE usename='aigc';

-- 如果不存在，创建用户
CREATE USER aigc WITH PASSWORD 'aigcpass';
```

**说明**:
- 用户名: `aigc`
- 密码: `aigcpass`
- 使用 `su - postgres` 切换到 postgres 用户执行
- 使用 `||` 实现幂等性（如果用户已存在则跳过）

---

### 4. 创建数据库

**脚本位置**: setup.sh 第 118-119 行

```bash
# 检查数据库是否存在，不存在则创建
su - postgres -c "psql -tc \"SELECT 1 FROM pg_database WHERE datname='aigc_prod'\"" | grep -q 1 || \
  su - postgres -c "psql -c \"CREATE DATABASE aigc_prod OWNER aigc;\""
```

**等价 SQL 语句**:
```sql
-- 检查数据库是否存在
SELECT 1 FROM pg_database WHERE datname='aigc_prod';

-- 如果不存在，创建数据库
CREATE DATABASE aigc_prod OWNER aigc;
```

**说明**:
- 数据库名: `aigc_prod`
- 所有者: `aigc` 用户
- 使用 `||` 实现幂等性（如果数据库已存在则跳过）

---

### 5. 执行数据库迁移

**脚本位置**: setup.sh 第 192-194 行

```bash
# 加载 .env 环境变量
set -a; source "$APP_DIR/.env"; set +a

# 执行迁移脚本
pnpm --filter @aigc/db migrate
```

**迁移脚本**: `packages/db/scripts/migrate.ts`

**迁移文件列表**:
```
packages/db/migrations/
├── 001_users.ts                    # 用户表
├── 002_subscription_plans.ts       # 订阅计划表
├── 003_auth_tables.ts              # 认证相关表（refresh_tokens, login_logs）
├── 004_teams.ts                    # 团队和工作区表
├── 005_credits.ts                  # 积分系统表
├── 006_tasks.ts                    # 任务和批次表
├── 007_security.ts                 # 安全相关表（prompt_filters）
├── 008_providers.ts                # 提供商和模型表
├── 009_workspace_members.ts        # 工作区成员表
├── 010_quota_period.ts             # 配额周期字段
├── 011_team_type.ts                # 团队类型字段
├── 012_soft_delete.ts              # 软删除字段
├── 013_video_thumbnail.ts          # 视频缩略图字段
├── 014_phone_login.ts              # 手机号登录字段
└── 015_drop_username_unique.ts     # 移除用户名唯一约束
```

**说明**:
- 迁移脚本会按顺序执行所有 `.ts` 文件
- 使用 Kysely 迁移系统，自动跟踪已执行的迁移
- 迁移是幂等的，重复执行不会出错

---

## 完整的数据库搭建 SQL 语句

如果你想手动搭建数据库（不使用 setup.sh），可以执行以下 SQL：

### 1. 连接到 PostgreSQL
```bash
sudo -u postgres psql
```

### 2. 创建用户
```sql
CREATE USER aigc WITH PASSWORD 'aigcpass';
```

### 3. 创建数据库
```sql
CREATE DATABASE aigc_prod OWNER aigc;
```

### 4. 授予权限（可选，OWNER 已包含所有权限）
```sql
GRANT ALL PRIVILEGES ON DATABASE aigc_prod TO aigc;
```

### 5. 退出并测试连接
```bash
\q
psql -U aigc -d aigc_prod -h localhost
```

### 6. 执行迁移
```bash
cd /opt/aigc
source .env
pnpm --filter @aigc/db migrate
```

---

## deploy.sh 数据库处理

**脚本位置**: deploy.sh 第 34-36 行

```bash
# 执行数据库迁移（幂等）
info "执行数据库迁移..."
set -a; source "$APP_DIR/.env"; set +a
pnpm --filter @aigc/db migrate
```

**说明**:
- deploy.sh **不会创建数据库**，只执行迁移
- 假设数据库已经由 setup.sh 创建
- 每次部署都会执行迁移（幂等，已执行的迁移会跳过）

---

## 数据库迁移系统详解

### 迁移脚本位置
```
packages/db/scripts/migrate.ts
```

### 迁移文件格式
```typescript
import type { Kysely } from 'kysely'

export async function up(db: Kysely<any>): Promise<void> {
  // 创建表、添加字段等
  await db.schema
    .createTable('users')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('email', 'text', (col) => col.notNull().unique())
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  // 回滚操作
  await db.schema.dropTable('users').execute()
}
```

### 迁移跟踪表
```sql
-- Kysely 自动创建的迁移跟踪表
CREATE TABLE kysely_migration (
  name VARCHAR(255) PRIMARY KEY,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 查看已执行的迁移
```sql
-- 连接到数据库
psql -U aigc -d aigc_prod

-- 查看已执行的迁移
SELECT * FROM kysely_migration ORDER BY timestamp;
```

---

## 数据库连接信息总结

### 新服务器（setup.sh 创建）
```
Host: localhost
Port: 5432
Database: aigc_prod
Username: aigc
Password: aigcpass

连接字符串:
postgresql://aigc:aigcpass@localhost:5432/aigc_prod
```

### 当前测试服务器
```
Host: localhost
Port: 5432
Database: aigc_test
Username: aigc
Password: 7aab0412ab975b0ab30202bcd1f05067

连接字符串:
postgresql://aigc:7aab0412ab975b0ab30202bcd1f05067@localhost:5432/aigc_test
```

---

## 常用数据库操作

### 1. 连接数据库
```bash
# 使用 postgres 用户
sudo -u postgres psql

# 使用 aigc 用户
psql -U aigc -d aigc_prod -h localhost
```

### 2. 查看所有数据库
```sql
\l
-- 或
SELECT datname FROM pg_database;
```

### 3. 查看所有用户
```sql
\du
-- 或
SELECT usename FROM pg_user;
```

### 4. 查看所有表
```sql
\dt
-- 或
SELECT tablename FROM pg_tables WHERE schemaname = 'public';
```

### 5. 查看表结构
```sql
\d users
-- 或
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'users';
```

### 6. 备份数据库
```bash
pg_dump -U aigc -d aigc_prod -h localhost > backup.sql
```

### 7. 恢复数据库
```bash
psql -U aigc -d aigc_prod -h localhost < backup.sql
```

### 8. 修改用户密码
```sql
ALTER USER aigc WITH PASSWORD 'new_password';
```

### 9. 删除数据库（危险操作）
```sql
DROP DATABASE aigc_prod;
```

### 10. 删除用户（危险操作）
```sql
DROP USER aigc;
```

---

## 生产环境安全建议

### 1. 修改默认密码
```bash
# 连接到 PostgreSQL
sudo -u postgres psql

# 修改密码
ALTER USER aigc WITH PASSWORD 'YOUR_STRONG_PASSWORD';
\q

# 更新 .env 文件
nano /opt/aigc/.env
# 修改 DATABASE_URL
```

### 2. 限制远程访问
```bash
# 编辑 PostgreSQL 配置
sudo nano /etc/postgresql/14/main/pg_hba.conf

# 确保只允许本地连接
# local   all             all                                     peer
# host    all             all             127.0.0.1/32            md5
# host    all             all             ::1/128                 md5

# 重启 PostgreSQL
sudo systemctl restart postgresql
```

### 3. 启用 SSL 连接
```bash
# 编辑 PostgreSQL 配置
sudo nano /etc/postgresql/14/main/postgresql.conf

# 启用 SSL
ssl = on
ssl_cert_file = '/etc/ssl/certs/ssl-cert-snakeoil.pem'
ssl_key_file = '/etc/ssl/private/ssl-cert-snakeoil.key'

# 重启 PostgreSQL
sudo systemctl restart postgresql
```

### 4. 定期备份
```bash
# 创建备份脚本
cat > /opt/aigc/backup-db.sh << 'EOF'
#!/bin/bash
BACKUP_DIR="/opt/aigc/backups"
DATE=$(date +%Y%m%d_%H%M%S)
mkdir -p "$BACKUP_DIR"
pg_dump -U aigc -d aigc_prod -h localhost > "$BACKUP_DIR/aigc_prod_$DATE.sql"
# 保留最近 7 天的备份
find "$BACKUP_DIR" -name "aigc_prod_*.sql" -mtime +7 -delete
EOF

chmod +x /opt/aigc/backup-db.sh

# 添加到 crontab（每天凌晨 2 点备份）
crontab -e
# 添加这一行
0 2 * * * /opt/aigc/backup-db.sh
```

---

## 故障排查

### 1. PostgreSQL 无法启动
```bash
# 查看日志
sudo tail -f /var/log/postgresql/postgresql-14-main.log

# 检查端口占用
sudo netstat -tulpn | grep 5432

# 检查服务状态
sudo systemctl status postgresql
```

### 2. 无法连接数据库
```bash
# 测试连接
pg_isready -h localhost -p 5432

# 检查防火墙
sudo ufw status

# 检查 PostgreSQL 监听地址
sudo grep listen_addresses /etc/postgresql/14/main/postgresql.conf
```

### 3. 权限问题
```sql
-- 授予所有权限
GRANT ALL PRIVILEGES ON DATABASE aigc_prod TO aigc;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO aigc;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO aigc;
```

---

## 总结

### setup.sh 数据库搭建步骤
1. ✅ 安装 PostgreSQL
2. ✅ 启动 PostgreSQL 服务
3. ✅ 创建用户 `aigc` (密码: `aigcpass`)
4. ✅ 创建数据库 `aigc_prod` (所有者: `aigc`)
5. ✅ 执行数据库迁移（创建所有表）

### deploy.sh 数据库处理
1. ✅ 执行数据库迁移（幂等，只执行新的迁移）

### 关键 SQL 语句
```sql
-- 创建用户
CREATE USER aigc WITH PASSWORD 'aigcpass';

-- 创建数据库
CREATE DATABASE aigc_prod OWNER aigc;
```

### 迁移系统
- 使用 Kysely 迁移框架
- 15 个迁移文件，按顺序执行
- 自动跟踪已执行的迁移
- 幂等性保证，可重复执行
