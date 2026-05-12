# ============================================================
# 阶段 1：依赖安装 + 构建（合并，避免 workspace 类型解析问题）
# ============================================================
FROM node:20-alpine AS builder

RUN apk add --no-cache libc6-compat python3 make g++

WORKDIR /repo

RUN corepack enable && corepack prepare pnpm@10.31.0 --activate

# 先复制所有 package.json，利用层缓存
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/api/package.json ./apps/api/
COPY packages/db/package.json ./packages/db/
COPY packages/types/package.json ./packages/types/

RUN pnpm install --frozen-lockfile

# 复制源码
COPY tsconfig.base.json ./
COPY apps/api ./apps/api
COPY packages/db ./packages/db
COPY packages/types ./packages/types

# 按依赖顺序构建
RUN pnpm --filter @aigc/types build
RUN pnpm --filter @aigc/db build
RUN pnpm --filter @aigc/api build

# 裁剪为生产依赖
RUN pnpm --filter @aigc/api --prod deploy --legacy /app/deploy

# ============================================================
# 阶段 2：生产镜像
# ============================================================
FROM node:20-alpine AS runner

RUN apk add --no-cache libc6-compat

WORKDIR /app

# 从 pnpm deploy 产物中复制（已包含生产 node_modules）
COPY --from=builder /app/deploy ./

# 复制 packages 的构建产物（pnpm deploy 不包含 workspace 包的 dist）
COPY --from=builder /repo/packages/db/dist ./node_modules/@aigc/db/dist
COPY --from=builder /repo/packages/types/dist ./node_modules/@aigc/types/dist

# 复制迁移脚本、seed 脚本和迁移文件（供 docker exec 手动执行）
COPY --from=builder /repo/packages/db/scripts ./migrate/scripts
COPY --from=builder /repo/packages/db/migrations ./migrate/migrations
COPY --from=builder /repo/packages/db/triggers.sql ./migrate/triggers.sql
COPY --from=builder /repo/packages/db/src ./migrate/src
# 安装 tsx 用于在容器内直接运行 TS 脚本
RUN npm install -g tsx

RUN addgroup -S aigc && adduser -S aigc -G aigc
USER aigc

EXPOSE 7001

CMD ["node", "dist/index.js"]
