-- Column covers: an image at the top of a column (its logo, its subject), framed by the
-- person. The bytes of small images live in the database for now, so backups and PITR
-- carry them; large attachments will go to object storage with their own storage_key.

ALTER TABLE attachments
  ADD COLUMN content bytea CHECK (content IS NULL OR octet_length(content) <= 2097152);
-- The same picture dropped twice is stored once.
CREATE INDEX attachments_sha_idx ON attachments (workspace_id, sha256) WHERE deleted_at IS NULL;

-- cover_id points at a ready image of the same workspace (the composite key is the third
-- wall, after row-level security and the workspace filter). cover holds the framing:
-- {x, y, z, w, h, bg}, validated by the op schema.
ALTER TABLE lanes
  ADD COLUMN cover_id uuid,
  ADD COLUMN cover jsonb CHECK (cover IS NULL OR jsonb_typeof(cover) = 'object'),
  ADD CONSTRAINT lanes_cover_pair CHECK ((cover_id IS NULL) = (cover IS NULL)),
  ADD FOREIGN KEY (cover_id, workspace_id) REFERENCES attachments (id, workspace_id);
CREATE INDEX lanes_cover_idx ON lanes (cover_id) WHERE cover_id IS NOT NULL;
