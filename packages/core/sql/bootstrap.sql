-- Noergo — one-time bootstrap of a PostgreSQL cluster (18 or newer). Run as a superuser:
--
--   psql -v migrator_password=... -v app_password=... -v jobs_password=... \
--        -f packages/core/sql/bootstrap.sql
--
-- Then apply the schema with `npm run db:deploy` (as noergo_migrator).

\ir roles.sql
\ir database.sql
