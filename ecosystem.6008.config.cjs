// 6008 组部署配置：web:6008 / api:7002 / Redis db 2 / 数据库 aigc_dev
// 启动前：cp deploy/6008/.env .env && pnpm --filter @aigc/web build
// 启动：pm2 start ecosystem.6008.config.cjs
const path = require('path')
const ROOT = __dirname
const LOGS = path.join(ROOT, 'logs/6008')

const script = (name) => {
  const local = path.join(ROOT, `${name}.sh`)
  const example = path.join(ROOT, `${name}.example.sh`)
  return require('fs').existsSync(local) ? local : example
}

module.exports = {
  apps: [
    {
      name: 'aigc-prod-api',
      script: script('start-api'),
      autorestart: true,
      max_restarts: 5,
      error_file: path.join(LOGS, 'api-err.log'),
      out_file: path.join(LOGS, 'api-out.log'),
    },
    {
      name: 'aigc-prod-worker',
      script: script('start-worker'),
      autorestart: true,
      max_restarts: 5,
      error_file: path.join(LOGS, 'worker-err.log'),
      out_file: path.join(LOGS, 'worker-out.log'),
    },
    {
      name: 'aigc-prod-web',
      script: script('start-web'),
      autorestart: true,
      max_restarts: 5,
      error_file: path.join(LOGS, 'web-err.log'),
      out_file: path.join(LOGS, 'web-out.log'),
    },
  ],
}
