-- A board's look: an icon before its name in the tab (one emoji, or the name of one of
-- noergo's line icons) and a colour behind its thoughts. The tab's own colour is
-- boards.color. The op schema checks the icon exactly; the length bound here is the
-- floor for any other writer. Both are drawn as text and CSS colour, never as markup.
ALTER TABLE boards
  ADD COLUMN icon varchar(32) CHECK (icon IS NULL OR char_length(icon) BETWEEN 1 AND 32),
  ADD COLUMN background char(7) CHECK (background ~ '^#[0-9a-f]{6}$');
