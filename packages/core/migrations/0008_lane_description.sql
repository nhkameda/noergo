-- A thought's description: a line or a paragraph under its title, on the card, the column
-- and the map. Plain text, never empty-versus-null: '' is "no description".
ALTER TABLE lanes
  ADD COLUMN description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 2000);
