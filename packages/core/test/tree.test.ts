import { describe, expect, it } from 'vitest';
import { laneTree, type TreeEdge, type TreeItem } from '../src/tree';

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

  it('folds only when everything below has one link in', () => {
    expect(laneTree(R, items(keys), edges).blocker('gabinete')).toBeNull();
    expect(laneTree(R, items(keys), edges).blocker('cnc')).toBe('leaf');
    expect(laneTree(R, items(keys), edges).blocker(R)).toBe('leaf');
    const shared = [...edges, ...links('outro>cnc')];
    expect(laneTree(R, items(keys), shared).blocker('gabinete')).toBe('cnc');
    // Linked between siblings is a second link in, too.
    expect(laneTree(R, items(keys), [...edges, ...links('extrusao>cnc')]).blocker('gabinete')).toBe('cnc');
  });

  it('keeps on show an idea that another way reaches, even when a fold sits on one of its ways', () => {
    const shared = [...edges, ...links('outro>cnc')];
    const t = laneTree(R, items(keys, 'gabinete'), shared);
    expect(t.hidden.has('cnc')).toBe(false);
    expect([...t.hidden].sort()).toEqual(['anodizacao', 'extrusao']);
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
