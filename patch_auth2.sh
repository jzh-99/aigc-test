# 替换 redis.publish 为 session_version (登录和接受邀请)
sed -i 's/await redis.publish(`user:kick:${user.id}`, JSON.stringify({ reason: '\'new_login\'' }))/const sessionVersion = Math.floor(Date.now() \/ 1000)\n    await redis.set(`user:session_version:${user.id}`, sessionVersion.toString(), '\''EX'\'', 7 * 24 * 60 * 60)/g' /root/autodl-tmp/aigc-test/apps/api/src/routes/auth.ts

# 替换 /auth/refresh 中的相关逻辑，如果在刷新 token 时也要记录最新的版本（可选，但目前为了保证旧的 token 继续用其实不需要，不过我们就在 refresh 处顺便更新下，避免 7 天后过期）
