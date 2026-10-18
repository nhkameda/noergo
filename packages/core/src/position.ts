import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing';

/**
 * Order inside a list is a fractional-index string. Moving an item writes one row, and
 * two concurrent inserts between the same neighbours produce the same key — ties are
 * broken by id, so every client still sees the same order.
 *
 * Keys are compared bytewise. The database uses the builtin C.UTF-8 locale for exactly
 * this reason; JavaScript string comparison already is bytewise for these characters.
 */
const KEY = /^[0-9A-Za-z]{1,128}$/;

export function isPosition(v: unknown): v is string {
  return typeof v === 'string' && KEY.test(v);
}

export function between(before: string | null, after: string | null): string {
  if (before !== null && after !== null && before >= after) return generateKeyBetween(before, null);
  return generateKeyBetween(before, after);
}

export function nBetween(before: string | null, after: string | null, n: number): string[] {
  return generateNKeysBetween(before, after, n);
}

export function comparePositioned(a: { position: string; id: string }, b: { position: string; id: string }): number {
  if (a.position < b.position) return -1;
  if (a.position > b.position) return 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
