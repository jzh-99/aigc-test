#!/usr/bin/env sh
# Clean BullMQ completed/failed job cache from the running worker container.
# Usage:
#   sh clean-bullmq-cache.sh --dry-run
#   sh clean-bullmq-cache.sh
#   sh clean-bullmq-cache.sh --queue image-queue --state failed

set -eu

CONTAINER_NAME="${CONTAINER_NAME:-aigc-worker}"

docker exec "$CONTAINER_NAME" node /app/apps/worker/dist/scripts/clean-bullmq-cache.js "$@"
