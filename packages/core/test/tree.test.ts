import { describe, expect, it } from 'vitest';
import { laneTree, levelFolds, type TreeEdge, type TreeItem } from '../src/tree';

const R = 'lane:r';
const items = (keys: string, folded = ''): TreeItem[] => keys.split(' ').map((k) => ({ key: k, collapsed: folded.split(' ').includes(k) }));
let n = 0;
const links = (spec: string): TreeEdge[] =>
  spec.split(' ').map((pair) => {
    const [from, to] = pair.split('>') as [string, string];
    return { id: `l${String(n++).padStart(4, '0')}`, from: from === 'R' ? R : from, to };
  });

describe('the tree of a thought', () => {
  // R > gabinete > extrusao, cnc, anodizacao; R > outro
  const keys = 'outro anodizacao gabinete cnc extrusao';
  const edges = links('R>gabinete gabinete>extrusao gabinete>cnc gabinete>anodizacao R>outro');

  it('puts what hangs from an idea under it, in column order, whatever the order of the column', () => {
    const t = laneTree(R, items(keys), edges);
    expect(t.order).toEqual(['outro', 'gabinete', 'anodizacao', 'cnc', 'extrusao']);
    expect(t.depth.get('cnc')).toBe(1);
    expect(t.parent.get('cnc')).toBe('gabinete');
    expect(t.parent.has('gabinete')).toBe(false);
    expect(t.hidden.size).toBe(0);
  });

  it('a fold hides every level below it and counts it', () => {
    const deeper = [...edges, ...links('cnc>fresa')];
    const t = laneTree(R, items(`${keys} fresa`, 'gabinete'), deeper);
    expect([...t.hidden].sort()).toEqual(['anodizacao', 'cnc', 'extrusao', 'fresa']);
    expect(t.folded.get('gabinete')).toHaveLength(4);
    // A fold inside a fold counts once, at the one on show.
    const both = laneTree(R, items(`${keys} fresa`, 'gabinete cnc'), deeper);
    expect([...both.folded.keys()]).toEqual(['gabinete']);
  });

  it('gives what hangs from an idea, at every level: what its fold hides', () => {
    const t = laneTree(R, items(`${keys} fresa`), [...edges, ...links('cnc>fresa')]);
    expect(t.below('gabinete')).toEqual(['anodizacao', 'cnc', 'fresa', 'extrusao']);
    expect(t.below('cnc')).toEqual(['fresa']);
    expect(t.below('outro')).toEqual([]);
    expect(t.below(R)).toEqual([]);
  });

  it('a fold hides its branch and only it, whatever lines cross it', () => {
    // outro also links to cnc, which hangs from gabinete by the older link.
    const shared = [...edges, ...links('outro>cnc')];
    expect([...laneTree(R, items(keys, 'gabinete'), shared).hidden].sort()).toEqual(['anodizacao', 'cnc', 'extrusao']);
    expect(laneTree(R, items(keys, 'outro'), shared).hidden.size).toBe(0);
    // Linked between siblings, too.
    expect([...laneTree(R, items(keys, 'gabinete'), [...edges, ...links('extrusao>cnc')]).hidden].sort()).toEqual(['anodizacao', 'cnc', 'extrusao']);
  });

  it('a line back to an earlier stage neither stops a fold nor widens it', () => {
    // R > dev > roteiro; R > analytics > ctr, ab, post; analytics feeds dev back.
    const k = 'dev roteiro analytics ctr ab post';
    const e = links('R>dev dev>roteiro R>analytics analytics>ctr analytics>ab analytics>post analytics>dev');
    const t = laneTree(R, items(k, 'analytics'), e);
    expect(t.parent.has('dev')).toBe(false);
    expect([...t.hidden].sort()).toEqual(['ab', 'ctr', 'post']);
    expect(t.folded.get('analytics')).toEqual(['ctr', 'ab', 'post']);
    expect(Object.fromEntries(levelFolds(laneTree(R, items(k), e), 1))).toMatchObject({ dev: true, analytics: true });
  });

  it('a loop with nothing above it starts at its first idea in the column, and nothing is lost', () => {
    const t = laneTree(R, items('b a c'), links('a>b b>a b>c'));
    expect(t.order).toEqual(['b', 'a', 'c']);
    expect(t.parent.has('b')).toBe(false);
    expect(t.depth.get('a')).toBe(1);
    const folded = laneTree(R, items('b a c', 'b'), links('a>b b>a b>c'));
    expect([...folded.hidden].sort()).toEqual(['a', 'c']);
  });

  it('a fold with nothing below hides nothing', () => {
    const t = laneTree(R, items(keys, 'cnc'), edges);
    expect(t.hidden.size).toBe(0);
    expect(t.folded.size).toBe(0);
  });
});

describe('levels on show', () => {
  // R > a > a1 > a11; R > b > b1; R > c (a leaf).
  const keys = 'a a1 a11 b b1 c';
  const edges = links('R>a a>a1 a1>a11 R>b b>b1 R>c');

  it('folds the last level where it can and opens the rest', () => {
    const t = laneTree(R, items(keys, 'a1'), edges);
    expect(Object.fromEntries(levelFolds(t, 1))).toEqual({ a: true, a1: false, a11: false, b: true, b1: false, c: false });
    expect(Object.fromEntries(levelFolds(t, 2))).toEqual({ a: false, a1: true, a11: false, b: false, b1: false, c: false });
    expect([...levelFolds(t, null).values()].every((v) => !v)).toBe(true);
  });

  it('folds a branch that a line from elsewhere reaches into', () => {
    const t = laneTree(R, items(keys), [...edges, ...links('c>a1')]);
    expect(Object.fromEntries(levelFolds(t, 1))).toMatchObject({ a: true, b: true, c: false });
  });
});
