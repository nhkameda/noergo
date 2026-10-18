-- Noergo — initial schema.
--
-- Source of truth for the database. Read docs/architecture.md before changing it:
-- * every content table carries workspace_id and is protected by row-level security
--   (FORCE, fail-closed when app.workspace_id is unset);
-- * positions are fractional-index strings compared bytewise, which is why the
--   database is created with the builtin C.UTF-8 locale (see packages/core/sql/database.sql);
-- * full-text search uses the 'simple' configuration over an IMMUTABLE unaccent wrapper,
--   because the content is multilingual (pt-BR, en, zh-CN) and stemming would be wrong
--   for two of the three languages.

CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- unaccent() is STABLE, so it cannot be used in an index or generated value.
-- Pinning the dictionary makes the wrapper safe to declare IMMUTABLE.
CREATE FUNCTION noergo_unaccent(text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  AS $$ SELECT public.unaccent('public.unaccent'::regdictionary, $1) $$;

-- The workspace of the current transaction. NULL when unset, so every policy that
-- compares against it matches no row (fail closed) instead of raising on ''::uuid.
CREATE FUNCTION app_workspace_id() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT NULLIF(current_setting('app.workspace_id', true), '')::uuid $$;

-- ───────────────────────────── identity (no RLS: resolved before a workspace is known)

CREATE TABLE users (
  id                uuid PRIMARY KEY DEFAULT uuidv7(),
  email             citext NOT NULL UNIQUE,
  email_verified_at timestamptz,
  name              varchar(200) NOT NULL DEFAULT '',
  image             text,
  locale            text NOT NULL DEFAULT 'en' CHECK (locale IN ('pt-BR', 'en', 'zh-CN')),
  role              text NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  session_epoch     integer NOT NULL DEFAULT 0,
  admin_unlimited   boolean NOT NULL DEFAULT false,
  trial_used_at     timestamptz,
  terms_version     text,
  terms_accepted_at timestamptz,
  signup_country    char(2),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz
);

-- Federated identities. Provider tokens are deliberately NOT stored: the app only
-- signs people in and never calls Google or Microsoft on their behalf.
CREATE TABLE accounts (
  id                  uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id             uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider            text NOT NULL,
  provider_account_id text NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  last_login_at       timestamptz,
  UNIQUE (provider, provider_account_id)
);
CREATE INDEX accounts_user_idx ON accounts (user_id);

-- One-time sign-in codes (optional email-code provider; off on noergo.com).
CREATE TABLE email_codes (
  id          uuid PRIMARY KEY DEFAULT uuidv7(),
  email       citext NOT NULL,
  code_hash   bytea NOT NULL,
  attempts    smallint NOT NULL DEFAULT 0,
  expires_at  timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX email_codes_email_idx ON email_codes (email, created_at DESC);

-- ───────────────────────────── workspaces

CREATE TABLE workspaces (
  id                  uuid PRIMARY KEY DEFAULT uuidv7(),
  owner_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name                varchar(200) NOT NULL DEFAULT '',
  -- Monotonic change counter. Incremented under the row lock of every write, so the
  -- sequence has no gaps and follows commit order (see packages/core/src/ops).
  seq                 bigint NOT NULL DEFAULT 0,
  -- Rows in notes, trash included (the worker decrements when it purges the trash).
  note_count          integer NOT NULL DEFAULT 0 CHECK (note_count >= 0),
  storage_bytes       bigint NOT NULL DEFAULT 0 CHECK (storage_bytes >= 0),
  storage_quota_bytes bigint NOT NULL,
  -- Where quick capture and agents drop notes when no column is given. Not a foreign
  -- key (lanes reference workspaces); the domain falls back to the first column.
  inbox_lane_id       uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX workspaces_owner_idx ON workspaces (owner_id);

CREATE TABLE workspace_members (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role         text NOT NULL DEFAULT 'owner' CHECK (role IN ('owner', 'editor', 'viewer')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);
CREATE INDEX workspace_members_user_idx ON workspace_members (user_id);

-- ───────────────────────────── agents (no RLS: a bearer token is resolved before its workspace)

CREATE TABLE agent_connections (
  id            uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  client_id     text NOT NULL,
  grant_id      text NOT NULL UNIQUE,
  client_name   varchar(200) NOT NULL DEFAULT '',
  redirect_host varchar(255) NOT NULL DEFAULT '',
  scopes        text[] NOT NULL DEFAULT '{}',
  read_only     boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_used_at  timestamptz,
  revoked_at    timestamptz
);
CREATE INDEX agent_connections_user_idx ON agent_connections (user_id) WHERE revoked_at IS NULL;

CREATE TABLE api_tokens (
  id           uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name         varchar(100) NOT NULL,
  prefix       varchar(16) NOT NULL,          -- shown in the UI to tell tokens apart
  token_hash   bytea NOT NULL UNIQUE,         -- sha256 of the full token; the token itself is never stored
  scopes       text[] NOT NULL DEFAULT '{notes:read,notes:write}',
  read_only    boolean NOT NULL DEFAULT false,
  expires_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);
CREATE INDEX api_tokens_user_idx ON api_tokens (user_id) WHERE revoked_at IS NULL;

-- oidc-provider storage (authorization codes, grants, tokens, registered clients, sessions).
CREATE TABLE oidc_payloads (
  id          text NOT NULL,
  type        text NOT NULL,
  payload     jsonb NOT NULL,
  grant_id    text,
  user_code   text,
  uid         text,
  expires_at  timestamptz,
  consumed_at timestamptz,
  PRIMARY KEY (id, type)
);
CREATE INDEX oidc_payloads_grant_idx ON oidc_payloads (grant_id) WHERE grant_id IS NOT NULL;
CREATE INDEX oidc_payloads_uid_idx ON oidc_payloads (uid) WHERE uid IS NOT NULL;
CREATE INDEX oidc_payloads_expires_idx ON oidc_payloads (expires_at) WHERE expires_at IS NOT NULL;

-- ───────────────────────────── content (RLS by workspace)

CREATE TABLE actors (
  id            uuid PRIMARY KEY DEFAULT uuidv7(),
  workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  kind          text NOT NULL CHECK (kind IN ('user', 'agent', 'token', 'system')),
  user_id       uuid REFERENCES users(id) ON DELETE SET NULL,
  connection_id uuid REFERENCES agent_connections(id) ON DELETE SET NULL,
  token_id      uuid REFERENCES api_tokens(id) ON DELETE SET NULL,
  label         varchar(200) NOT NULL DEFAULT '',
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, workspace_id)
);
CREATE UNIQUE INDEX actors_user_uq ON actors (workspace_id, user_id) WHERE kind = 'user';
CREATE UNIQUE INDEX actors_connection_uq ON actors (workspace_id, connection_id) WHERE kind = 'agent';
CREATE UNIQUE INDEX actors_token_uq ON actors (workspace_id, token_id) WHERE kind = 'token';
CREATE UNIQUE INDEX actors_system_uq ON actors (workspace_id) WHERE kind = 'system';

CREATE TABLE boards (
  id           uuid PRIMARY KEY DEFAULT uuidv7(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  title        varchar(200) NOT NULL,
  color        char(7) CHECK (color ~ '^#[0-9a-f]{6}$'),
  position     text NOT NULL,
  version      integer NOT NULL DEFAULT 1,
  created_by   uuid,
  updated_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz,
  UNIQUE (id, workspace_id)
);
CREATE INDEX boards_order_idx ON boards (workspace_id, position) WHERE deleted_at IS NULL;

-- "Columns" in the UI. Named lanes because COLUMN is a reserved word in SQL.
CREATE TABLE lanes (
  id           uuid PRIMARY KEY DEFAULT uuidv7(),
  workspace_id uuid NOT NULL,
  board_id     uuid NOT NULL,
  title        varchar(200) NOT NULL,
  color        char(7) CHECK (color ~ '^#[0-9a-f]{6}$'),
  position     text NOT NULL,
  version      integer NOT NULL DEFAULT 1,
  created_by   uuid,
  updated_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz,
  UNIQUE (id, workspace_id),
  FOREIGN KEY (board_id, workspace_id) REFERENCES boards (id, workspace_id) ON DELETE CASCADE
);
CREATE INDEX lanes_order_idx ON lanes (workspace_id, board_id, position) WHERE deleted_at IS NULL;

CREATE TABLE attachments (
  id           uuid PRIMARY KEY DEFAULT uuidv7(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  storage_key  text NOT NULL UNIQUE,
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ready', 'rejected')),
  mime         varchar(120) NOT NULL,
  size_bytes   bigint NOT NULL CHECK (size_bytes >= 0),
  sha256       char(64),
  name         varchar(300) NOT NULL DEFAULT '',
  width        integer,
  height       integer,
  created_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz,
  UNIQUE (id, workspace_id)
);
CREATE INDEX attachments_status_idx ON attachments (status, created_at) WHERE status = 'pending';

CREATE TABLE notes (
  id            uuid PRIMARY KEY DEFAULT uuidv7(),
  workspace_id  uuid NOT NULL,
  lane_id       uuid NOT NULL,
  position      text NOT NULL,
  kind          text NOT NULL DEFAULT 'text' CHECK (kind IN ('text', 'image', 'link', 'file')),
  title         varchar(300) NOT NULL DEFAULT '',
  body          text NOT NULL DEFAULT '' CHECK (char_length(body) <= 100000),
  url           text CHECK (url IS NULL OR (char_length(url) <= 2048 AND url ~* '^(https?|mailto):')),
  attachment_id uuid,
  color         char(7) CHECK (color ~ '^#[0-9a-f]{6}$'),
  tags          text[] NOT NULL DEFAULT '{}' CHECK (cardinality(tags) <= 50),
  done_at       timestamptz,
  due_at        timestamptz,
  version       integer NOT NULL DEFAULT 1,
  created_by    uuid,
  updated_by    uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz,
  fts           tsvector,
  UNIQUE (id, workspace_id),
  FOREIGN KEY (lane_id, workspace_id) REFERENCES lanes (id, workspace_id) ON DELETE CASCADE,
  FOREIGN KEY (attachment_id, workspace_id) REFERENCES attachments (id, workspace_id)
);
CREATE INDEX notes_order_idx ON notes (workspace_id, lane_id, position) WHERE deleted_at IS NULL;
CREATE INDEX notes_recent_idx ON notes (workspace_id, updated_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX notes_trash_idx ON notes (workspace_id, deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX notes_due_idx ON notes (workspace_id, due_at) WHERE deleted_at IS NULL AND done_at IS NULL AND due_at IS NOT NULL;
CREATE INDEX notes_fts_idx ON notes USING gin (fts);
CREATE INDEX notes_title_trgm_idx ON notes USING gin (title gin_trgm_ops);
-- Resolves [[Title]] wikilinks (case-insensitive exact title).
CREATE INDEX notes_title_lower_idx ON notes (workspace_id, lower(title)) WHERE deleted_at IS NULL;
CREATE INDEX notes_tags_idx ON notes USING gin (tags);

CREATE FUNCTION notes_fts_refresh() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.fts :=
    setweight(to_tsvector('simple', noergo_unaccent(coalesce(NEW.title, ''))), 'A') ||
    setweight(to_tsvector('simple', noergo_unaccent(array_to_string(NEW.tags, ' '))), 'B') ||
    setweight(to_tsvector('simple', noergo_unaccent(coalesce(NEW.body, ''))), 'C');
  RETURN NEW;
END $$;
CREATE TRIGGER notes_fts_trg BEFORE INSERT OR UPDATE OF title, body, tags ON notes
  FOR EACH ROW EXECUTE FUNCTION notes_fts_refresh();

-- Connections between thoughts. Endpoints are polymorphic (a note, a lane hub or a
-- board hub), so integrity is enforced by the domain operations, which check that both
-- ends exist inside the same workspace before writing.
CREATE TABLE links (
  id           uuid PRIMARY KEY DEFAULT uuidv7(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  from_kind    text NOT NULL CHECK (from_kind IN ('note', 'lane', 'board')),
  from_id      uuid NOT NULL,
  to_kind      text NOT NULL CHECK (to_kind IN ('note', 'lane', 'board')),
  to_id        uuid NOT NULL,
  origin       text NOT NULL DEFAULT 'manual' CHECK (origin IN ('manual', 'wikilink')),
  label        varchar(200) NOT NULL DEFAULT '',
  style        jsonb NOT NULL DEFAULT '{}',
  version      integer NOT NULL DEFAULT 1,
  created_by   uuid,
  updated_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz,
  CHECK (NOT (from_kind = to_kind AND from_id = to_id))
);
CREATE UNIQUE INDEX links_pair_uq ON links (workspace_id, from_kind, from_id, to_kind, to_id, origin) WHERE deleted_at IS NULL;
CREATE INDEX links_to_idx ON links (workspace_id, to_kind, to_id) WHERE deleted_at IS NULL;
CREATE INDEX links_from_idx ON links (workspace_id, from_kind, from_id) WHERE deleted_at IS NULL;

-- [[Title]] references that matched no note yet. When a note with that title appears
-- (create, rename, restore), the notes waiting for it are re-linked.
CREATE TABLE unresolved_wikilinks (
  workspace_id uuid NOT NULL,
  note_id      uuid NOT NULL,
  title_lower  varchar(300) NOT NULL,
  PRIMARY KEY (workspace_id, title_lower, note_id),
  FOREIGN KEY (note_id, workspace_id) REFERENCES notes (id, workspace_id) ON DELETE CASCADE
);
CREATE INDEX unresolved_wikilinks_note_idx ON unresolved_wikilinks (workspace_id, note_id);

-- Where each node sits in each visual view. The same note can be placed differently in
-- its column map, its board map and the global graph.
CREATE TABLE node_layouts (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  view_kind    text NOT NULL CHECK (view_kind IN ('lane_map', 'board_map', 'graph')),
  view_id      uuid NOT NULL,
  node_kind    text NOT NULL CHECK (node_kind IN ('note', 'lane', 'board')),
  node_id      uuid NOT NULL,
  x            double precision NOT NULL CHECK (x BETWEEN -1000000 AND 1000000),
  y            double precision NOT NULL CHECK (y BETWEEN -1000000 AND 1000000),
  shape        text NOT NULL DEFAULT 'pill' CHECK (shape IN ('pill', 'rounded', 'rect', 'ellipse', 'diamond', 'plain')),
  fill         text NOT NULL DEFAULT 'soft' CHECK (fill IN ('solid', 'soft', 'outline')),
  size         text NOT NULL DEFAULT 'm' CHECK (size IN ('s', 'm', 'l')),
  color        char(7) CHECK (color ~ '^#[0-9a-f]{6}$'),
  version      integer NOT NULL DEFAULT 1,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, view_kind, view_id, node_kind, node_id)
);
CREATE INDEX node_layouts_node_idx ON node_layouts (workspace_id, node_kind, node_id);

CREATE TABLE note_revisions (
  id           uuid PRIMARY KEY DEFAULT uuidv7(),
  workspace_id uuid NOT NULL,
  note_id      uuid NOT NULL,
  version      integer NOT NULL,
  title        varchar(300) NOT NULL,
  body         text NOT NULL,
  tags         text[] NOT NULL,
  actor_id     uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (note_id, workspace_id) REFERENCES notes (id, workspace_id) ON DELETE CASCADE
);
CREATE INDEX note_revisions_note_idx ON note_revisions (workspace_id, note_id, version DESC);

-- The change log: drives live sync (SSE resume by seq), the activity feed and revert.
CREATE TABLE changes (
  workspace_id    uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  seq             bigint NOT NULL,
  actor_id        uuid,
  op_id           uuid,
  op              text NOT NULL,
  entity_kind     text NOT NULL,
  entity_id       uuid NOT NULL,
  effects         jsonb NOT NULL,
  reverted_by_seq bigint,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, seq)
);
CREATE INDEX changes_time_idx ON changes (workspace_id, created_at DESC);
CREATE INDEX changes_entity_idx ON changes (workspace_id, entity_kind, entity_id, seq DESC);

-- Idempotency receipts for client operations (a retried op_id returns the stored result).
CREATE TABLE op_receipts (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  op_id        uuid NOT NULL,
  result       jsonb NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, op_id)
);
CREATE INDEX op_receipts_time_idx ON op_receipts (created_at);

-- ───────────────────────────── row-level security

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['actors', 'boards', 'lanes', 'attachments', 'notes', 'links',
                           'unresolved_wikilinks', 'node_layouts', 'note_revisions', 'changes',
                           'op_receipts'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY workspace_isolation ON %I USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id())',
      t);
  END LOOP;
END $$;

ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspaces FORCE ROW LEVEL SECURITY;
-- The owner may read the workspace rows they own without a context (used to open a session);
-- writes always require the context.
CREATE POLICY workspace_self ON workspaces
  USING (id = app_workspace_id())
  WITH CHECK (id = app_workspace_id());
CREATE POLICY workspace_lookup ON workspaces FOR SELECT
  USING (owner_id = NULLIF(current_setting('app.user_id', true), '')::uuid);

-- ───────────────────────────── billing (one subscription per user)

CREATE TABLE plans (
  id                  text PRIMARY KEY,                  -- 'free' | 'pro'
  name                varchar(100) NOT NULL,
  price_usd_cents     integer NOT NULL DEFAULT 0 CHECK (price_usd_cents >= 0),
  billing_interval    text NOT NULL DEFAULT 'month' CHECK (billing_interval IN ('month', 'year')),
  trial_days          integer NOT NULL DEFAULT 0,
  stripe_price_id     text,
  storage_quota_bytes bigint NOT NULL,
  mcp_enabled         boolean NOT NULL DEFAULT false,
  is_active           boolean NOT NULL DEFAULT true,
  display_order       integer NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE subscriptions (
  id                     uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id                uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  plan_id                text NOT NULL REFERENCES plans(id),
  status                 text NOT NULL CHECK (status IN ('ACTIVE', 'TRIALING', 'PAST_DUE', 'INCOMPLETE', 'CANCELED', 'SUSPENDED')),
  currency               char(3) NOT NULL DEFAULT 'usd',
  price_cents            integer NOT NULL DEFAULT 0,
  billing_interval       text NOT NULL DEFAULT 'month',
  trial_ends_at          timestamptz,
  current_period_start   timestamptz,
  current_period_end     timestamptz,
  cancel_at_period_end   boolean NOT NULL DEFAULT false,
  canceled_at            timestamptz,
  past_due_since         timestamptz,
  stripe_customer_id     text,
  stripe_subscription_id text UNIQUE,
  stripe_price_id        text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX subscriptions_customer_idx ON subscriptions (stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;

CREATE TABLE payments (
  id                  uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id             uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subscription_id     uuid REFERENCES subscriptions(id) ON DELETE SET NULL,
  amount_cents        integer NOT NULL,
  currency            char(3) NOT NULL,
  status              text NOT NULL,
  provider_invoice_id text UNIQUE,
  provider_charge_id  text UNIQUE,
  failure_reason      text,
  period_start        timestamptz,
  period_end          timestamptz,
  paid_at             timestamptz,
  refunded_cents      integer NOT NULL DEFAULT 0,
  refunded_at         timestamptz,
  dispute_status      text,
  hosted_invoice_url  text,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payments_user_idx ON payments (user_id, created_at DESC);

CREATE TABLE stripe_events (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  stripe_event_id text NOT NULL UNIQUE,
  type            text NOT NULL,
  livemode        boolean NOT NULL,
  payload         jsonb NOT NULL,
  processed       boolean NOT NULL DEFAULT false,
  processed_at    timestamptz,
  error           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX stripe_events_pending_idx ON stripe_events (processed, created_at);

-- ───────────────────────────── audit and security signals

CREATE TABLE audit_log (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  action     text NOT NULL,
  target     text,
  details    jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_user_idx ON audit_log (user_id, created_at DESC);
CREATE INDEX audit_log_action_idx ON audit_log (action, created_at DESC);

-- Coalesced by key (e.g. "<ip-hash>|<kind>|<window>") so a scanner cannot grow the table.
CREATE TABLE security_events (
  key        text PRIMARY KEY,
  kind       text NOT NULL,
  target     text,
  reason     text,
  count      integer NOT NULL DEFAULT 1,
  first_at   timestamptz NOT NULL DEFAULT now(),
  last_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX security_events_kind_idx ON security_events (kind, last_at DESC);

INSERT INTO plans (id, name, price_usd_cents, trial_days, storage_quota_bytes, mcp_enabled, display_order) VALUES
  ('free', 'Free', 0, 0, 262144000, false, 0),       -- 250 MB
  ('pro',  'Pro', 1000, 7, 5368709120, true, 1);     -- 5 GB, USD 10/month

-- ───────────────────────────── privileges
--
-- database.sql gives the runtime roles full DML on every table the migrator creates.
-- Each table now loses what its role never needs, so a bug or an injected query in web
-- or mcp cannot hard-delete content (only the worker purges the trash), rewrite the
-- change log or the audit trail, or touch the migration history.
REVOKE ALL ON schema_migrations FROM noergo_app, noergo_jobs;
REVOKE INSERT, UPDATE, DELETE ON plans FROM noergo_app, noergo_jobs;
REVOKE DELETE ON boards, lanes, notes, links, attachments, actors, note_revisions, changes,
  op_receipts, audit_log, payments, stripe_events FROM noergo_app;
REVOKE UPDATE ON note_revisions, op_receipts, audit_log FROM noergo_app;
REVOKE UPDATE ON audit_log FROM noergo_jobs;
