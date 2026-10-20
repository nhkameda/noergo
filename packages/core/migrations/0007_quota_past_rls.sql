-- 0006 handed every workspace the instance's quota with an UPDATE that matched no row:
-- FORCE row-level security binds the owner too, and the migrator sets no workspace, so the
-- policy filtered everything out, silently. Here the owner sets FORCE aside for this one
-- statement; the ALTER holds an exclusive lock until this transaction commits, so no other
-- session ever sees workspaces without it.
ALTER TABLE workspaces NO FORCE ROW LEVEL SECURITY;
UPDATE workspaces SET storage_quota_bytes = NULL WHERE storage_quota_bytes IS NOT NULL;
ALTER TABLE workspaces FORCE ROW LEVEL SECURITY;
