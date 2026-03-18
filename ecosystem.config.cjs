const path = require('path')
const ROOT = __dirname
const LOGS = path.join(ROOT, 'logs')

module.exports = {
  apps: [
    {
      name: 'aigc-test-api',
      script: path.join(ROOT, 'start-api.sh'),
      autorestart: true,
      max_restarts: 5,
      error_file: path.join(LOGS, 'api-err.log'),
      out_file: path.join(LOGS, 'api-out.log'),
    },
    {
      name: 'aigc-test-worker',
      script: path.join(ROOT, 'start-worker.sh'),
      autorestart: true,
      max_restarts: 5,
      error_file: path.join(LOGS, 'worker-err.log'),
      out_file: path.join(LOGS, 'worker-out.log'),
    },
    {
      name: 'aigc-test-web',
      script: path.join(ROOT, 'start-web.sh'),
      autorestart: true,
      max_restarts: 5,
      error_file: path.join(LOGS, 'web-err.log'),
      out_file: path.join(LOGS, 'web-out.log'),
    },
  ],
}
