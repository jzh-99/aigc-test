#!/bin/bash
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

[ -f "$DIR/.env" ] || { echo ".env is missing" >&2; exit 1; }
[ -f "$DIR/prompts.env" ] || { echo "prompts.env is missing" >&2; exit 1; }

set -a
source "$DIR/.env"
source "$DIR/prompts.env"
set +a

apps/api/node_modules/.bin/tsx apps/api/src/index.ts
