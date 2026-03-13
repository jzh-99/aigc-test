#!/bin/bash
set -a
source /root/autodl-tmp/aigc-test/.env
set +a
cd /root/autodl-tmp/aigc-test
cd apps/web && npx next start -p 6006
