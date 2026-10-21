-- An idea folded shut: what hangs from it is hidden in the column and on the map, on every
-- device. A view of the tree, not a change to it; nothing is moved or deleted.
ALTER TABLE notes
  ADD COLUMN collapsed boolean NOT NULL DEFAULT false;
