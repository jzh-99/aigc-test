#!/bin/bash
set -a
source /root/autodl-tmp/aigc-test/.env
set +a
cd /root/autodl-tmp/aigc-test
npx tsx apps/worker/src/index.ts
