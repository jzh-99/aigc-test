## code graph
```
# 在项目中初始化（-i 表示交互式）
codegraph init -i


# 非交互式安装（CI 环境）
# 自动检测所有已安装代理，全局安装
codegraph install --yes

# 指定目标代理
codegraph install --target=cursor,claude,codex --yes

# 项目级别安装
codegraph install --target=auto --location=local


# 更新同步
codegraph sync


## 验证安装
codegraph status          # 查看索引状态和统计
codegraph query "UserService"  # 测试符号搜索

参考：https://blog.csdn.net/chendongqi2007/article/details/161292757
```

## 本地运行
### 开发

```bash
# 启动所有服务（并行）
pnpm dev

# 单独启动某个应用
pnpm --filter @aigc/web dev       # 前端 :6006
pnpm --filter @aigc/api dev       # API  :7001
pnpm --filter @aigc/worker dev    # Worker

### 数据库

```bash
pnpm db:migrate     # 执行迁移
pnpm db:seed        # 填充种子数据
```

## 项目部署

### 项目编译打包

### 服务部署 ---- api / worker / web 服务器（以 api 为例）----
docker load < aigc-web.tar.gz
cp .env.example .env
cp docker-compose.yml docker-compose.yml
vi .env                              # 填写 INFRA_HOST 及各项密钥
docker compose up -d


docker load < aigc-web.tar.gz
docker-compose up -d --force-recreate # 强制重新构建容器

### 数据库迁移
API 容器正在运行时
#### 结构迁移
在 API 服务器 /home/vmuser/projects/aigc-api 下执行：
```
docker exec -it aigc-api sh -lc 'tsx /app/migrate/scripts/migrate.ts'
```
#### 数据迁移
执行 seed：
```
docker exec -it aigc-api sh -lc 'tsx /app/migrate/scripts/seed.ts'
```