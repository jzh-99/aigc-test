#!/bin/bash
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
set -a
source "$DIR/.env"
set +a
cd "$DIR/apps/web"
npx next start -p 6006
