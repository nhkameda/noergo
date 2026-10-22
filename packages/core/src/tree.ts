/**
 * The ideas of a thought as a tree, read from its links: what the column indents and what
 * folding hides, on the map and in the column alike, and what agents are told. Keys are
 * `note:<id>`, and `lane:<id>` for the centre, as on the map.
 *
 * An idea hangs from the one its oldest link in comes from (like the map's placement). A
 * folded idea hides what is reached through its links out; an idea that still has a way
 * down from the centre that skips every fold stays on show. Folding is allowed only when
 * each idea it would hide has one link in, so a fold never hides half of something.
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
  /** Hidden by a fold. */
  hidden: ReadonlySet<string>;
  /** A folded idea on show → every idea it hides, at every level. */
  folded: ReadonlyMap<string, readonly string[]>;
  /** What a fold of `key` would hide (its links out, all the way down). */
  below(key: string): readonly string[];
  /** Null when `key` can fold; 'leaf' when nothing hangs from it; else the first idea below it with more than one link in. */
  blocker(key: string): null | 'leaf' | string;
}

export function laneTree(rootKey: string, items: readonly TreeItem[], edges: readonly TreeEdge[]): LaneTree {
  const index = new Map(items.map((it, i) => [it.key, i]));
  const out = new Map<string, string[]>();
  const into = new Map<string, Set<string>>();
  const oldest = new Map<string, TreeEdge>();
  for (const e of edges) {
    if (e.from === e.to || !index.has(e.to) || (e.from !== rootKey && !index.has(e.from))) continue;
    const from = into.get(e.to) ?? new Set();
    if (!from.has(e.from)) {
      from.add(e.from);
      into.set(e.to, from);
      out.set(e.from, [...(out.get(e.from) ?? []), e.to]);
    }
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

  // On show: reached from the centre or from the top of the column without passing a fold.
  const collapsed = new Set(items.filter((it) => it.collapsed).map((it) => it.key));
  const shown = new Set<string>([rootKey]);
  const queue: string[] = [rootKey];
  for (const it of items) {
    if (parent.has(it.key)) continue;
    shown.add(it.key);
    queue.push(it.key);
  }
  for (let i = 0; i < queue.length; i++) {
    const k = queue[i]!;
    if (collapsed.has(k)) continue;
    for (const c of out.get(k) ?? []) {
      if (shown.has(c)) continue;
      shown.add(c);
      queue.push(c);
    }
  }
  const hidden = new Set(items.map((it) => it.key).filter((k) => !shown.has(k)));

  const folded = new Map<string, string[]>();
  if (hidden.size) {
    for (const k of order) {
      if (!collapsed.has(k) || hidden.has(k)) continue;
      const seen = new Set<string>();
      const walk = [...(out.get(k) ?? [])];
      for (let i = 0; i < walk.length; i++) {
        const c = walk[i]!;
        if (seen.has(c) || !hidden.has(c)) continue;
        seen.add(c);
        walk.push(...(out.get(c) ?? []));
      }
      if (seen.size) folded.set(k, [...seen]);
    }
  }

  const belowCache = new Map<string, string[]>();
  const below = (key: string): string[] => {
    const hit = belowCache.get(key);
    if (hit) return hit;
    const seen = new Set<string>([key, rootKey]);
    const list: string[] = [];
    const walk = [...(out.get(key) ?? [])];
    for (let i = 0; i < walk.length; i++) {
      const c = walk[i]!;
      if (seen.has(c)) continue;
      seen.add(c);
      list.push(c);
      walk.push(...(out.get(c) ?? []));
    }
    belowCache.set(key, list);
    return list;
  };

  const blocker = (key: string): null | 'leaf' | string => {
    if (key === rootKey) return 'leaf';
    const list = below(key);
    if (!list.length) return 'leaf';
    let first: string | null = null;
    for (const k of list) {
      if ((into.get(k)?.size ?? 0) > 1 && (first === null || index.get(k)! < index.get(first)!)) first = k;
    }
    return first;
  };

  return { parent, order, depth, hidden, folded, below, blocker };
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
 * folds what hangs from it where it can, and every other idea opens, so that fold is the
 * only one. Ideas at the top of the column are the first level. Gives each idea's fold.
 */
export function levelFolds(tree: LaneTree, levels: number | null): Map<string, boolean> {
  const out = new Map<string, boolean>();
  for (const k of tree.order) out.set(k, levels !== null && tree.depth.get(k) === levels - 1 && tree.blocker(k) === null);
  return out;
}

/**
 * Whether `to` is reached from `from` by links out, the links in `skip` aside: a line drawn
 * the wrong way between two ideas is no loop once it is the one being turned round.
 */
export function reaches(links: readonly { id: string; from: { kind: string; id: string }; to: { kind: string; id: string } }[], from: string, to: string, skip: ReadonlySet<string>): boolean {
  const out = new Map<string, string[]>();
  for (const l of links) if (!skip.has(l.id)) out.set(keyOf(l.from), [...(out.get(keyOf(l.from)) ?? []), keyOf(l.to)]);
  const seen = new Set([from]);
  const queue = [from];
  while (queue.length) {
    for (const next of out.get(queue.pop()!) ?? []) {
      if (next === to) return true;
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return false;
}
