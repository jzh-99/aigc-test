#!/bin/bash
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
set -a
source "$DIR/.env"
set +a
cd "$DIR"
npx tsx apps/worker/src/index.ts
