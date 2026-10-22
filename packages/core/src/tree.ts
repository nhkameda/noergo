/**
 * The ideas of a thought as a tree, read from its links: what the column indents and what
 * folding hides, on the map and in the column alike, and what agents are told. Keys are
 * `note:<id>`, and `lane:<id>` for the centre, as on the map.
 *
 * An idea hangs from the one its oldest link in comes from (like the map's placement). A
 * folded idea hides what hangs from it, at every level, and only that, as in any mind map: a
 * line across branches (one stage feeding an earlier one back, say) neither keeps an idea of
 * the folded branch on show nor hides the idea at its other end.
 */

export interface TreeItem {
  key: string;
  collapsed: boolean;
}

export interface TreeEdge {
  id: string;
  from: string;
  to: string;
}

export interface LaneTree {
  /** The idea each one hangs from; none for those at the top of the column. */
  parent: ReadonlyMap<string, string>;
  /** Column order: each idea followed by what hangs from it, in column order too. */
  order: readonly string[];
  depth: ReadonlyMap<string, number>;
  /** Hidden by a fold: something it hangs from, at some level, is folded. */
  hidden: ReadonlySet<string>;
  /** A folded idea on show → every idea it hides, at every level. */
  folded: ReadonlyMap<string, readonly string[]>;
  /** What hangs from `key`, at every level, in column order: what a fold of it hides and what goes where it goes. None for the centre. */
  below(key: string): readonly string[];
}

export function laneTree(rootKey: string, items: readonly TreeItem[], edges: readonly TreeEdge[]): LaneTree {
  const known = new Set(items.map((it) => it.key));
  const oldest = new Map<string, TreeEdge>();
  for (const e of edges) {
    if (e.from === e.to || !known.has(e.to) || (e.from !== rootKey && !known.has(e.from))) continue;
    const cur = oldest.get(e.to);
    if (!cur || e.id < cur.id) oldest.set(e.to, e);
  }

  // The column: hanging from the centre is the top.
  const parent = new Map<string, string>();
  for (const [to, e] of oldest) if (e.from !== rootKey) parent.set(to, e.from);
  const kids = new Map<string, string[]>();
  for (const it of items) {
    const p = parent.get(it.key);
    if (p) kids.set(p, [...(kids.get(p) ?? []), it.key]);
  }
  const order: string[] = [];
  const depth = new Map<string, number>();
  const visit = (k: string, d: number) => {
    if (depth.has(k)) return;
    depth.set(k, d);
    order.push(k);
    for (const c of kids.get(k) ?? []) visit(c, d + 1);
  };
  for (const it of items) if (!parent.has(it.key)) visit(it.key, 0);
  // What is left hangs in a loop: its first idea in column order goes to the top.
  for (const it of items) {
    if (depth.has(it.key)) continue;
    const p = parent.get(it.key)!;
    kids.set(p, kids.get(p)!.filter((c) => c !== it.key));
    parent.delete(it.key);
    visit(it.key, 0);
  }

  // A branch is the run of deeper ideas right after its idea in column order.
  const at = new Map(order.map((k, i) => [k, i]));
  const below = (key: string): string[] => {
    const i = at.get(key);
    if (i === undefined) return [];
    const d = depth.get(key)!;
    let j = i + 1;
    while (j < order.length && depth.get(order[j]!)! > d) j++;
    return order.slice(i + 1, j);
  };

  // Column order visits a fold before the folds inside it, which then count with it.
  const hidden = new Set<string>();
  const folded = new Map<string, string[]>();
  const collapsed = new Set(items.filter((it) => it.collapsed).map((it) => it.key));
  for (const k of order) {
    if (!collapsed.has(k) || hidden.has(k)) continue;
    const list = below(k);
    for (const c of list) hidden.add(c);
    if (list.length) folded.set(k, list);
  }

  return { parent, order, depth, hidden, folded, below };
}

const keyOf = (r: { kind: string; id: string }) => `${r.kind}:${r.id}`;

/** The tree of a thought from its ideas (in column order) and the links among them. */
export function thoughtTree(laneId: string, ideas: readonly { id: string; collapsed: boolean }[], links: readonly { id: string; from: { kind: string; id: string }; to: { kind: string; id: string } }[]): LaneTree {
  return laneTree(
    `lane:${laneId}`,
    ideas.map((n) => ({ key: `note:${n.id}`, collapsed: n.collapsed })),
    links.map((l) => ({ id: l.id, from: keyOf(l.from), to: keyOf(l.to) })),
  );
}

/**
 * The folds that show `levels` levels of a tree (null: all of it): each idea on the last level
 * folds what hangs from it, and every other idea opens, so that fold is the only one. Ideas
 * at the top of the column are the first level. Gives each idea's fold.
 */
export function levelFolds(tree: LaneTree, levels: number | null): Map<string, boolean> {
  const out = new Map<string, boolean>();
  for (const k of tree.order) out.set(k, levels !== null && tree.depth.get(k) === levels - 1 && tree.below(k).length > 0);
  return out;
}
