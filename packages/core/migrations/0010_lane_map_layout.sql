-- How a thought's mind map is laid out: from its tree ('balanced' on both sides of the
-- centre, 'right', 'left', or 'down' like an org chart), re-laid as ideas come, go and fold;
-- or 'free', where every idea stays where it was put. New thoughts start balanced.
ALTER TABLE lanes
  ADD COLUMN map_layout text NOT NULL DEFAULT 'balanced' CHECK (map_layout IN ('balanced', 'right', 'left', 'down', 'free'));

-- A map someone already arranged keeps its places: free, when any of its ideas has a stored
-- spot. FORCE row-level security binds the owner too and the migrator sets no workspace, so
-- each table read here sets it aside for this statement (see 0007).
ALTER TABLE lanes NO FORCE ROW LEVEL SECURITY;
ALTER TABLE notes NO FORCE ROW LEVEL SECURITY;
ALTER TABLE node_layouts NO FORCE ROW LEVEL SECURITY;
UPDATE lanes l SET map_layout = 'free'
WHERE EXISTS (
  SELECT 1 FROM node_layouts nl
  JOIN notes n ON n.id = nl.node_id AND n.workspace_id = nl.workspace_id
  WHERE nl.workspace_id = l.workspace_id AND nl.view_kind = 'lane_map' AND nl.view_id = l.id
    AND nl.node_kind = 'note' AND n.lane_id = l.id AND n.deleted_at IS NULL
);
ALTER TABLE lanes FORCE ROW LEVEL SECURITY;
ALTER TABLE notes FORCE ROW LEVEL SECURITY;
ALTER TABLE node_layouts FORCE ROW LEVEL SECURITY;
