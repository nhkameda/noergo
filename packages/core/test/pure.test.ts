import { describe, expect, it } from 'vitest';
import { between, comparePositioned, isPosition, nBetween } from '../src/position';
import { opSchema } from '../src/ops/schema';
import { parseWikilinks, renameInBody } from '../src/ops/wikilinks';

describe('position', () => {
  it('orders keys bytewise, like the database collation', () => {
    const keys = nBetween(null, null, 50);
    expect([...keys].sort()).toEqual(keys);
    const mid = between(keys[10]!, keys[11]!);
    expect(mid > keys[10]! && mid < keys[11]!).toBe(true);
    expect(isPosition(mid)).toBe(true);
  });

  it('recovers from neighbours that arrive out of order', () => {
    expect(isPosition(between('a1', 'a0'))).toBe(true);
  });

  it('breaks ties by id so every client agrees', () => {
    const a = { position: 'a0', id: 'b' };
    const b = { position: 'a0', id: 'a' };
    expect([a, b].sort(comparePositioned).map((x) => x.id)).toEqual(['a', 'b']);
  });
});

describe('op schema', () => {
  const id = '0190c2a8-3b1e-7c3a-9d2e-2f1a0b9c8d7e';

  it('normalises tags', () => {
    const op = opSchema.parse({ type: 'note.create', id, laneId: id, title: ' x ', tags: ['#Ideia', 'ideia'] });
    expect(op.type === 'note.create' && op.tags).toEqual(['ideia', 'ideia']);
    expect(op.type === 'note.create' && op.title).toBe('x');
  });

  it('rejects scriptable links', () => {
    for (const url of ['javascript:alert(1)', 'data:text/html,x', 'file:///etc/passwd', 'vbscript:x']) {
      expect(opSchema.safeParse({ type: 'note.create', id, laneId: id, title: 'x', url }).success).toBe(false);
    }
    expect(opSchema.safeParse({ type: 'note.create', id, laneId: id, title: 'x', url: 'https://noergo.com' }).success).toBe(true);
  });

  it('takes only an http(s) address as a thought’s website', () => {
    for (const url of ['javascript:alert(1)', 'mailto:a@noergo.com', 'data:text/html,x', 'noergo.com', '/relative']) {
      expect(opSchema.safeParse({ type: 'lane.update', id, url }).success).toBe(false);
      expect(opSchema.safeParse({ type: 'lane.create', id, boardId: id, title: 'x', url }).success).toBe(false);
    }
    const op = opSchema.parse({ type: 'lane.update', id, url: ' https://noergo.com/ ' });
    expect(op.type === 'lane.update' && op.url).toBe('https://noergo.com/');
    expect(opSchema.safeParse({ type: 'lane.update', id, url: null }).success).toBe(true);
  });

  it('rejects unknown link style keys and bad positions', () => {
    expect(opSchema.safeParse({ type: 'link.update', id, style: { onclick: 'x' } }).success).toBe(false);
    expect(opSchema.safeParse({ type: 'note.move', id, laneId: id, place: { position: "a0'; --" } }).success).toBe(false);
  });
});

describe('wikilinks', () => {
  it('parses titles, aliases and ids, once each, outside code', () => {
    const body = 'See [[Plano]] and [[plano|o plano]], [[note:0190C2A8-3B1E-7C3A-9D2E-2F1A0B9C8D7E]].\n`[[Not a link]]`\n```\n[[Neither]]\n```';
    expect(parseWikilinks(body)).toEqual([{ title: 'Plano' }, { id: '0190c2a8-3b1e-7c3a-9d2e-2f1a0b9c8d7e' }]);
  });

  it('renames links but keeps aliases and code', () => {
    const body = '[[Plano]] [[plano|alias]] [[Planos]] `[[Plano]]`';
    expect(renameInBody(body, 'Plano', 'Roteiro')).toBe('[[Roteiro]] [[Roteiro|alias]] [[Planos]] `[[Plano]]`');
  });
});
