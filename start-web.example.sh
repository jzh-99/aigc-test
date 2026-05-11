#!/bin/bash
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

[ -f "$DIR/.env" ] || { echo ".env is missing" >&2; exit 1; }
[ -f "$DIR/apps/web/.next/BUILD_ID" ] || {
  echo "Missing Next.js production build. Run pnpm --filter @aigc/web build before starting web." >&2
  exit 1
}

set -a
source "$DIR/.env"
set +a

exec pnpm --filter @aigc/web start
