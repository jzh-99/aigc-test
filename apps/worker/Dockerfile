# ============================================================
# 阶段 1：依赖安装 + 构建
# ============================================================
FROM node:20-alpine AS builder

RUN apk add --no-cache libc6-compat python3 make g++

WORKDIR /repo

RUN corepack enable && corepack prepare pnpm@10.31.0 --activate

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/worker/package.json ./apps/worker/
COPY packages/db/package.json ./packages/db/
COPY packages/types/package.json ./packages/types/

RUN pnpm install --frozen-lockfile

COPY tsconfig.base.json ./
COPY apps/worker ./apps/worker
COPY packages/db ./packages/db
COPY packages/types ./packages/types

RUN pnpm --filter @aigc/types build
RUN pnpm --filter @aigc/db build
RUN pnpm --filter @aigc/worker build

RUN pnpm --filter @aigc/worker --prod deploy --legacy /app/deploy

# ============================================================
# 阶段 2：生产镜像
# ============================================================
FROM node:20-alpine AS runner

RUN apk add --no-cache libc6-compat

WORKDIR /app

COPY --from=builder /app/deploy ./
# pnpm deploy 只复制依赖，需手动补充构建产物
COPY --from=builder /repo/apps/worker/dist ./apps/worker/dist
COPY --from=builder /repo/packages/db/dist ./node_modules/@aigc/db/dist
COPY --from=builder /repo/packages/types/dist ./node_modules/@aigc/types/dist

RUN addgroup -S aigc && adduser -S aigc -G aigc
USER aigc

CMD ["node", "apps/worker/dist/index.js"]
