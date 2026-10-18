#!/bin/sh
# Starts one noergo process. Configuration comes only from the environment
# (see docker/.env.example and docs/configuration.md).
set -eu

case "${1:-web}" in
  web)     cd /app/web/apps/web && exec node server.js ;;
  mcp)     exec node --enable-source-maps /app/mcp/index.mjs ;;
  worker)  exec node --enable-source-maps /app/worker/index.mjs ;;
  migrate) exec node --enable-source-maps /app/migrate/migrate.mjs ;;
  *)       exec "$@" ;;
esac
