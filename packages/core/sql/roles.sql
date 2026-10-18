-- Noergo — database roles, by least privilege. Run once per PostgreSQL cluster, as a
-- superuser, through bootstrap.sql (which passes the passwords as psql variables).
--
--   noergo_migrator  owns the schema; used only to run migrations.
--   noergo_app       used by web and mcp; subject to row-level security (no BYPASSRLS).
--   noergo_jobs      used by the worker for cross-workspace maintenance (trash purge,
--                    attachment GC); the only role allowed to bypass row-level security.

\set ON_ERROR_STOP on

CREATE ROLE noergo_migrator LOGIN PASSWORD :'migrator_password';
CREATE ROLE noergo_app      LOGIN PASSWORD :'app_password' NOBYPASSRLS;
CREATE ROLE noergo_jobs     LOGIN PASSWORD :'jobs_password' BYPASSRLS;
