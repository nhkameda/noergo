import { diff_match_patch } from 'diff-match-patch';

/**
 * Body edits travel as diff-match-patch patches against the version the editor started
 * from, so a person typing and an agent appending to the same note both keep their words.
 * The server applies the patch exactly, then fuzzily; the editor rebases what is still
 * unsent onto whatever body comes back.
 */
const dmp = new diff_match_patch();

/** The patch text that turns `from` into `to`; empty when they are equal. */
export function makePatch(from: string, to: string): string {
  if (from === to) return '';
  return dmp.patch_toText(dmp.patch_make(from, to));
}

/**
 * Carries the local edits (`base` → `local`) over to a newer body. When the remote and the
 * local edits touch different places this is exact; when they overlap, diff-match-patch
 * keeps what it can and `clean` is false.
 */
export function rebase(base: string, local: string, remote: string): { text: string; clean: boolean } {
  if (base === local) return { text: remote, clean: true };
  if (base === remote) return { text: local, clean: true };
  const [text, applied] = dmp.patch_apply(dmp.patch_make(base, local), remote);
  return { text, clean: applied.every(Boolean) };
}

/** Where a caret at `pos` in `before` ends up in `after`. */
export function mapCaret(before: string, after: string, pos: number): number {
  if (before === after) return pos;
  return dmp.diff_xIndex(dmp.diff_main(before, after), pos);
}
