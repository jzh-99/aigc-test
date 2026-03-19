#!/bin/bash
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
set -a
source "$DIR/.env"
set +a
cd "$DIR"
apps/worker/node_modules/.bin/tsx apps/worker/src/index.ts
