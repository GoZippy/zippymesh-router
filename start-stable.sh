#!/usr/bin/env bash
# ZippyMesh LLM Router - start the production standalone build from a SOURCE TREE.
#
#   ./start-stable.sh          loopback only (http://127.0.0.1:20128)
#   ./start-stable.sh --lan    also reachable from other machines on the network
#
# A released zip carries its own start-stable.sh next to server.js; this one is
# for running the build you produced with `npm run build` out of the repo.
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -f .next/standalone/server.js ]; then
  echo "No standalone build found. Run:  npm run build" >&2
  exit 1
fi
if [ ! -d .next/standalone/.next/static ]; then
  node scripts/prepare-standalone.cjs
fi

# server.js chdir()s into .next/standalone, so it would otherwise only see
# .next/standalone/.env. Point it at the .env in this directory instead.
if [ -f .env ]; then
  export ZIPPY_ENV_FILE="$PWD/.env"
fi

# Do NOT default PORT / ZIPPY_BIND_HOST here: server.js resolves them from the
# environment first, then .env, then falls back to 127.0.0.1:20128.
if [ "${1:-}" = "--lan" ]; then
  export ZIPPY_BIND_HOST=0.0.0.0
  echo "LAN mode: this node will be reachable from other machines. Enable login at /setup first."
fi

echo "Starting ZippyMesh Router (default http://127.0.0.1:20128; .env can override PORT / ZIPPY_BIND_HOST)"
exec node .next/standalone/server.js
