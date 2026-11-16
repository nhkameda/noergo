-- An idea can be a picture: the note points at a stored image (attachment_id, kind 'image')
-- and keeps its size here, taken from the file when it is set, so every screen draws the
-- idea's shape at the right proportions before the picture has arrived.
ALTER TABLE notes ADD COLUMN image jsonb CHECK (image IS NULL OR (jsonb_typeof(image) = 'object' AND attachment_id IS NOT NULL));
