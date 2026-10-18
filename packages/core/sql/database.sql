-- Noergo — creates one database for the roles of roles.sql. Run as a superuser:
--
--   psql -v dbname=noergo -f packages/core/sql/database.sql      (dbname defaults to noergo)
--
-- The database uses the builtin C.UTF-8 locale: fractional-index positions must sort
-- bytewise, exactly like JavaScript string comparison. Do not change it.
--
-- The test harness (packages/core/test/harness.ts) runs this same file, so keep it to
-- plain statements plus the psql lines below.

\set ON_ERROR_STOP on
\if :{?dbname}
\else
  \set dbname noergo
\endif

CREATE DATABASE :"dbname" OWNER noergo_migrator TEMPLATE template0 ENCODING 'UTF8'
  LOCALE_PROVIDER builtin BUILTIN_LOCALE 'C.UTF-8';

\connect :"dbname"

-- Extensions need a superuser; create them here so migrations can run as the owner.
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

REVOKE ALL ON DATABASE :"dbname" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"dbname" TO noergo_app, noergo_jobs;
GRANT CREATE ON DATABASE :"dbname" TO noergo_migrator;
ALTER SCHEMA public OWNER TO noergo_migrator;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO noergo_app, noergo_jobs;

-- Every object the migrator creates is usable by the runtime roles, in any schema
-- (public and pgboss). DDL stays with the migrator.
ALTER DEFAULT PRIVILEGES FOR ROLE noergo_migrator
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO noergo_app, noergo_jobs;
ALTER DEFAULT PRIVILEGES FOR ROLE noergo_migrator
  GRANT USAGE, SELECT ON SEQUENCES TO noergo_app, noergo_jobs;
ALTER DEFAULT PRIVILEGES FOR ROLE noergo_migrator
  GRANT EXECUTE ON FUNCTIONS TO noergo_app, noergo_jobs;
