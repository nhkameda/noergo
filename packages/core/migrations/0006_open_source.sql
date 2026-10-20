-- noergo is open source only: no plans, no payments. The billing tables never held a row
-- (Stripe was never wired); this refuses to run if one ever did, rather than lose it.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM subscriptions) OR EXISTS (SELECT 1 FROM payments) OR EXISTS (SELECT 1 FROM stripe_events) THEN
    RAISE EXCEPTION 'billing tables hold rows: export them before 0006 drops them';
  END IF;
END $$;

DROP TABLE stripe_events, payments, subscriptions, plans;

-- Agents are switched on by the administrator, for everyone or account by account
-- (settings.agents). blocked_at keeps a person out of every session, token and sign-in
-- until an administrator lets them back; nothing they wrote is touched.
ALTER TABLE users
  DROP COLUMN trial_used_at,
  ADD COLUMN blocked_at timestamptz;
ALTER TABLE users RENAME COLUMN admin_unlimited TO agents_allowed;

-- A workspace's own quota is an exception; NULL takes the instance's (settings).
ALTER TABLE workspaces ALTER COLUMN storage_quota_bytes DROP NOT NULL;
UPDATE workspaces SET storage_quota_bytes = NULL;

-- The instance's settings, one row. A NULL column inherits the environment (SIGNUP,
-- SIGNUP_ALLOWLIST, MCP_ACCESS), then the default: what an administrator saves wins.
CREATE TABLE settings (
  id                  boolean PRIMARY KEY DEFAULT true CHECK (id),
  signup              text CHECK (signup IN ('open', 'allowlist')),
  signup_allowlist    text[] CHECK (cardinality(signup_allowlist) <= 1000),
  agents              text CHECK (agents IN ('all', 'granted')),
  storage_quota_bytes bigint NOT NULL DEFAULT 262144000 CHECK (storage_quota_bytes > 0), -- 250 MB
  updated_at          timestamptz NOT NULL DEFAULT now(),
  updated_by          uuid REFERENCES users(id) ON DELETE SET NULL
);
INSERT INTO settings DEFAULT VALUES;

-- database.sql hands every new table full DML; the row is only ever read and updated,
-- and only the web (as noergo_app, behind the admin check) updates it.
REVOKE INSERT, DELETE ON settings FROM noergo_app, noergo_jobs;
REVOKE UPDATE ON settings FROM noergo_jobs;
