#!/bin/sh
# Local PostgreSQL 18 for development and tests: its own data directory (outside the
# repository, ~/.local/share/noergo/pg18 by default), port 5434, listening on 127.0.0.1 only. A loopback-only throwaway cluster, so it uses
# trust authentication and no passwords exist anywhere.
#
#   npm run db:dev            start (creates the cluster, roles, database and schema once)
#   npm run db:dev -- stop
#   npm run db:dev -- psql    open psql as the superuser
set -eu

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SQL="$ROOT/packages/core/sql"
PG_BIN="${PG_BIN:-$(brew --prefix postgresql@18 2>/dev/null || echo /usr/lib/postgresql/18)/bin}"
DATA="${NOERGO_DEV_PGDATA:-${XDG_DATA_HOME:-$HOME/.local/share}/noergo/pg18}"
PORT="${NOERGO_DEV_PGPORT:-5434}"
PSQL="$PG_BIN/psql -h 127.0.0.1 -p $PORT -U postgres -v ON_ERROR_STOP=1 -q"

case "${1:-start}" in
  start)
    first=0
    if [ ! -f "$DATA/PG_VERSION" ]; then
      mkdir -p "$DATA"
      "$PG_BIN/initdb" -D "$DATA" -U postgres --auth=trust --encoding=UTF8 \
        --locale-provider=builtin --builtin-locale=C.UTF-8 --lc-messages=C >/dev/null
      first=1
    fi
    if ! "$PG_BIN/pg_ctl" -D "$DATA" status >/dev/null 2>&1; then
      "$PG_BIN/pg_ctl" -D "$DATA" -l "$DATA/server.log" -w \
        -o "-p $PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=''" start >/dev/null
    fi
    if [ "$first" = 1 ]; then
      $PSQL -d postgres -c "CREATE ROLE noergo_migrator LOGIN; CREATE ROLE noergo_app LOGIN NOBYPASSRLS; CREATE ROLE noergo_jobs LOGIN BYPASSRLS;"
      $PSQL -d postgres -f "$SQL/database.sql"
    fi
    DATABASE_MIGRATOR_URL="postgres://noergo_migrator@127.0.0.1:$PORT/noergo" \
      npx --prefix "$ROOT" tsx "$ROOT/packages/core/scripts/migrate.ts"
    echo "PostgreSQL 18 on 127.0.0.1:$PORT — DATABASE_URL=postgres://noergo_app@127.0.0.1:$PORT/noergo"
    ;;
  stop) "$PG_BIN/pg_ctl" -D "$DATA" -w stop ;;
  psql) exec $PSQL -d "${2:-noergo}" ;;
  *) echo "usage: $0 [start|stop|psql [db]]" >&2; exit 2 ;;
esac
