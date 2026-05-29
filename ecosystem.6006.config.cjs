// 6006 组部署配置：web:6006 / api:7001 / Redis db 3 / 数据库 aigc_dev
// 启动前：cp deploy/6006/.env .env && pnpm --filter @aigc/web build
// 启动：pm2 start ecosystem.6006.config.cjs
const path = require('path')
const ROOT = __dirname
const LOGS = path.join(ROOT, 'logs/6006')

const script = (name) => {
  const local = path.join(ROOT, `${name}.sh`)
  const example = path.join(ROOT, `${name}.example.sh`)
  return require('fs').existsSync(local) ? local : example
}

module.exports = {
  apps: [
    {
      name: 'aigc-test-api',
      script: script('start-api'),
      autorestart: true,
      max_restarts: 5,
      error_file: path.join(LOGS, 'api-err.log'),
      out_file: path.join(LOGS, 'api-out.log'),
    },
    {
      name: 'aigc-test-worker',
      script: script('start-worker'),
      autorestart: true,
      max_restarts: 5,
      error_file: path.join(LOGS, 'worker-err.log'),
      out_file: path.join(LOGS, 'worker-out.log'),
    },
    {
      name: 'aigc-test-web',
      script: script('start-web'),
      autorestart: true,
      max_restarts: 5,
      error_file: path.join(LOGS, 'web-err.log'),
      out_file: path.join(LOGS, 'web-out.log'),
    },
  ],
}
