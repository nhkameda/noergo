-- Links that open one board or one thought (lane) to whoever holds them: to look at it,
-- or also to change it. The link itself is never stored: it is the share id plus an HMAC
-- of it under a key derived from AUTH_SECRET (packages/core/src/shares.ts), so the owner
-- can copy it again and a copy of the database alone opens nothing.
--
-- No row-level security, like api_tokens: a link is resolved before its workspace is
-- known. Every function in shares.ts filters by workspace_id itself, and what a link opens
-- is read inside withWorkspace() as everything else.
CREATE TABLE shares (
  id           uuid PRIMARY KEY DEFAULT uuidv7(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  -- Polymorphic like links: the domain checks the target lives in this workspace.
  target_kind  text NOT NULL CHECK (target_kind IN ('board', 'lane')),
  target_id    uuid NOT NULL,
  access       text NOT NULL CHECK (access IN ('view', 'edit')),
  created_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  revoked_at   timestamptz
);
-- One live link per target and access: sharing again hands out the same link.
CREATE UNIQUE INDEX shares_live_uq ON shares (workspace_id, target_kind, target_id, access) WHERE revoked_at IS NULL;

-- Turning a link off is an UPDATE (revoked_at); nothing at runtime deletes one.
REVOKE DELETE ON shares FROM noergo_app;
