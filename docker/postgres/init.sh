#!/bin/sh
# Runs once, on the first start of the bundled PostgreSQL container (self-hosting).
set -eu
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
  -v migrator_password="$NOERGO_DB_MIGRATOR_PASSWORD" \
  -v app_password="$NOERGO_DB_APP_PASSWORD" \
  -v jobs_password="$NOERGO_DB_JOBS_PASSWORD" \
  -f /noergo/bootstrap.sql
