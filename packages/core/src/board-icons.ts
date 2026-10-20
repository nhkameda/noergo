/**
 * What a board can wear before its name in the tab: one emoji, or one of noergo's line
 * icons by name (the web draws them). Names are lowercase ASCII, so they can never be
 * mistaken for an emoji.
 */
export const BOARD_ICONS = [
  'home',
  'work',
  'star',
  'heart',
  'idea',
  'book',
  'school',
  'code',
  'people',
  'money',
  'chart',
  'cart',
  'target',
  'flag',
  'calendar',
  'pin',
  'globe',
  'music',
  'camera',
  'leaf',
] as const;
export type BoardIconName = (typeof BOARD_ICONS)[number];

/** Long enough for the longest emoji sequence (a family, a flag of a region), in UTF-16 units. */
export const BOARD_ICON_MAX = 32;

let pattern: RegExp | undefined;

/**
 * Exactly one emoji as Unicode recommends it (RGI): a ZWJ family, a flag or a keycap counts
 * as one; "1", "❤" without its emoji variation selector, two emoji or any text do not. The
 * `v` flag does that, and the server always has it. A browser without it (Safari before 17)
 * falls back to a looser pattern; the server stays the judge.
 */
function emojiPattern(): RegExp {
  if (pattern) return pattern;
  try {
    pattern = new RegExp('^\\p{RGI_Emoji}$', 'v');
  } catch {
    pattern = /^(?:\p{Regional_Indicator}{2}|[#*0-9]\uFE0F\u20E3|\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?)*)$/u;
  }
  return pattern;
}

export function isEmoji(s: string): boolean {
  return s.length <= BOARD_ICON_MAX && emojiPattern().test(s);
}

export function isBoardIcon(s: string): boolean {
  return (BOARD_ICONS as readonly string[]).includes(s) || isEmoji(s);
}
