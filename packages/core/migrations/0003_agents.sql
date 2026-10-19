-- Agents over MCP: what a person has open, so an agent can write "here", and a security
-- log with enough to act on (the admin reads it).

-- What each person has on screen right now. The web writes it when a view or a thought's
-- map opens, and every minute while it stays open; an agent asking for "the open thought"
-- gets it only while it is recent (packages/core/src/agents.ts).
CREATE TABLE user_focus (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  board_id     uuid,
  lane_id      uuid,
  view         text NOT NULL CHECK (view IN ('board', 'cards', 'dates', 'map')),
  at           timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);
ALTER TABLE user_focus ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_focus FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON user_focus
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());

-- Still coalesced by key (source, kind, hour), so a scanner cannot grow the table; the
-- columns keep the last occurrence. IPs are kept 90 days (apps/worker), then the row goes.
ALTER TABLE security_events
  ADD COLUMN severity   text NOT NULL DEFAULT 'low' CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  ADD COLUMN ip         inet,
  ADD COLUMN country    char(2),
  ADD COLUMN user_agent varchar(300),
  ADD COLUMN path       varchar(300),
  ADD COLUMN user_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN seen_at    timestamptz;
CREATE INDEX security_events_time_idx ON security_events (last_at DESC);
CREATE INDEX security_events_unseen_idx ON security_events (last_at DESC) WHERE seen_at IS NULL AND severity IN ('high', 'critical');
