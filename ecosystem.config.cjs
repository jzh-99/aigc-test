module.exports = {
  "apps": [
    {
      "name": "aigc-test-api",
      "script": "/root/autodl-tmp/aigc-test/start-api.sh",
      "autorestart": true,
      "max_restarts": 5,
      "error_file": "/root/autodl-tmp/logs/test-api-err.log",
      "out_file": "/root/autodl-tmp/logs/test-api-out.log"
    },
    {
      "name": "aigc-test-worker",
      "script": "/root/autodl-tmp/aigc-test/start-worker.sh",
      "autorestart": true,
      "max_restarts": 5,
      "error_file": "/root/autodl-tmp/logs/test-worker-err.log",
      "out_file": "/root/autodl-tmp/logs/test-worker-out.log"
    },
    {
      "name": "aigc-test-web",
      "script": "/root/autodl-tmp/aigc-test/start-web.sh",
      "autorestart": true,
      "max_restarts": 5,
      "error_file": "/root/autodl-tmp/logs/test-web-err.log",
      "out_file": "/root/autodl-tmp/logs/test-web-out.log"
    }
  ]
}
