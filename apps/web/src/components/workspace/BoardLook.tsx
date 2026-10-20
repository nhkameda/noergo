'use client';

import { BOARD_ICONS, isEmoji, type BoardIconName } from '@noergo/core/board-icons';
import type { BoardDto } from '@noergo/core/dto';
import { LIMITS } from '@noergo/core/limits';
import { useTranslations } from 'next-intl';
import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { useWorkspace } from './context';
import { NameField, openPanel } from './Customize';
import { IconBoardGlyph, IconClose } from './icons';
import { inkOn } from './map';
import { colorName, PALETTE } from './model';

export interface BoardLookTarget {
  boardId: string;
  anchor: DOMRect;
}

type Colours = { color: string | null; background: string | null };

/** The emoji offered first (with "no icon", three rows of ten); any other can be typed or pasted. */
const EMOJI = ['🏠', '💼', '🚀', '💡', '⭐', '❤️', '🎯', '📚', '🎓', '💰', '📈', '🛒', '🎨', '🎵', '✈️', '🌱', '🧠', '🛠️', '📅', '✅', '🏃', '🍳', '🐶', '🎮', '🔥', '🌎', '⚽', '🎉', '🧩'];

const isIconName = (s: string): s is BoardIconName => (BOARD_ICONS as readonly string[]).includes(s);

// While the native colour picker is dragged, the tab and the board follow it; the colour
// is saved (one undo step) when the picker lets go.
const previews = new Map<string, Partial<Colours>>();
const listeners = new Set<() => void>();

function preview(boardId: string, key: keyof Colours, value: string | null | undefined) {
  const next = { ...previews.get(boardId) };
  if (value === undefined) delete next[key];
  else next[key] = value;
  if (Object.keys(next).length) previews.set(boardId, next);
  else previews.delete(boardId);
  for (const l of listeners) l();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

/** A board's icon and colours as shown: what is stored, or the colour being picked. */
export function useBoardLook(board: BoardDto | undefined): ({ icon: string | null } & Colours) | undefined {
  const shown = useSyncExternalStore(
    subscribe,
    () => (board ? previews.get(board.id) : undefined),
    () => undefined,
  );
  if (!board) return undefined;
  return {
    icon: board.icon,
    color: shown?.color !== undefined ? shown.color : board.color,
    background: shown?.background !== undefined ? shown.background : board.background,
  };
}

/** The icon before a board's name: an emoji as text, or one of the line icons. */
export function BoardGlyph({ icon }: { icon: string | null }) {
  if (!icon) return null;
  return (
    <span className="w-board-glyph" aria-hidden="true">
      {isIconName(icon) ? <IconBoardGlyph name={icon} /> : icon}
    </span>
  );
}

/** A coloured tab: the colour itself, with the ink that reads on it. */
export function tabProps(color: string | null): { 'data-colored'?: true; style?: CSSProperties } {
  return color ? { 'data-colored': true, style: { '--tab': color, '--tab-on': inkOn(color) } as CSSProperties } : {};
}

/**
 * The emoji in what was typed or pasted, as Unicode spells it: the last one wins, and a
 * heart typed without its emoji selector ("❤") gets it.
 */
export function emojiIn(text: string): string | null {
  const graphemes = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text.trim())].map((g) => g.segment);
  for (const g of graphemes.reverse()) {
    if (isEmoji(g)) return g;
    if (!g.includes('\uFE0F') && isEmoji(`${g}\uFE0F`)) return `${g}\uFE0F`;
  }
  return null;
}

/**
 * A board's name, icon, tab colour and background, in one place under its tab. Every
 * change shows at once in the tab and behind the thoughts, and each is one undo step.
 */
export function BoardLookPanel({ board, anchor, onClose }: { board: BoardDto; anchor: DOMRect; onClose: () => void }) {
  const t = useTranslations('app');
  const { actions } = useWorkspace();
  const panel = useRef<HTMLDivElement>(null);
  const look = useBoardLook(board)!;
  const close = () => panel.current?.hidePopover();

  // Opened from the board's menu: the focus goes in, to the icon it wears now.
  useLayoutEffect(() => {
    const p = panel.current;
    if (!p) return;
    openPanel(p, anchor, 'below');
    p.querySelector<HTMLElement>('.w-board-look__icons [tabindex="0"]')?.focus({ preventScroll: true });
  }, [anchor]);

  const closed = useEffectEvent(() => onClose());
  useEffect(() => {
    const p = panel.current;
    if (!p) return;
    const onToggle = (e: Event) => {
      if ((e as ToggleEvent).newState === 'closed') closed();
    };
    p.addEventListener('toggle', onToggle);
    return () => p.removeEventListener('toggle', onToggle);
  }, []);

  return (
    <div ref={panel} popover="auto" className="w-customize w-board-look" role="dialog" aria-labelledby="w-board-look-kicker w-board-look-title" data-board={board.id}>
      <header className="w-customize__head">
        <div className="w-customize__names">
          <h2 id="w-board-look-kicker" className="w-customize__kicker">
            {t('boardLook.kicker')}
          </h2>
          <NameField id="w-board-look-title" value={board.title} label={t('boardName')} maxLength={LIMITS.boardTitle} onSave={(title) => actions.updateBoard(board.id, { title })} />
        </div>
        <button type="button" className="w-icon-btn" onClick={close} aria-label={t('customize.close')} title={t('customize.close')}>
          <IconClose />
        </button>
      </header>

      <IconChoice board={board} />
      <ColourChoice
        id="w-board-look-tab"
        label={t('boardLook.tab')}
        value={look.color}
        onPreview={(c) => preview(board.id, 'color', c)}
        onSave={(color) => actions.updateBoard(board.id, { color })}
      />
      <ColourChoice
        id="w-board-look-bg"
        label={t('boardLook.background')}
        hint={t('boardLook.backgroundHint')}
        value={look.background}
        onPreview={(c) => preview(board.id, 'background', c)}
        onSave={(background) => actions.updateBoard(board.id, { background })}
      />

      <footer className="w-customize__foot">
        <button type="button" className="nr-btn nr-btn--sm nr-btn--primario" onClick={close}>
          {t('customize.done')}
        </button>
      </footer>
    </div>
  );
}

/**
 * Arrow keys walk a radio group without choosing (each choice is a saved change); Space
 * or Enter chooses. Only the chosen one is in the Tab order.
 */
function walkRadios(e: KeyboardEvent<HTMLElement>) {
  const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
  if (step === undefined && e.key !== 'Home' && e.key !== 'End') return;
  const radios = [...e.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]')];
  const i = radios.indexOf(document.activeElement as HTMLElement);
  if (i < 0) return;
  e.preventDefault();
  const next = e.key === 'Home' ? 0 : e.key === 'End' ? radios.length - 1 : (i + step! + radios.length) % radios.length;
  radios[next]!.focus();
}

function IconChoice({ board }: { board: BoardDto }) {
  const t = useTranslations('app');
  const { actions } = useWorkspace();
  const [typed, setTyped] = useState('');
  const current = board.icon;
  // An emoji typed earlier stays in sight, chosen, at the head of the list.
  const extra = current && !isIconName(current) && !EMOJI.includes(current) ? current : null;
  const emoji = extra ? [extra, ...EMOJI] : EMOJI;
  const choose = (icon: string | null) => actions.updateBoard(board.id, { icon });
  const invalid = typed.trim() !== '';
  const radio = (value: string | null, label: string, content: ReactNode) => (
    <button
      key={value ?? 'none'}
      type="button"
      role="radio"
      aria-checked={current === value}
      tabIndex={current === value ? 0 : -1}
      className={value === null ? 'w-swatch w-swatch--none' : 'w-glyph-choice'}
      aria-label={label}
      title={label}
      onClick={() => choose(value)}
    >
      {content}
    </button>
  );
  return (
    <section className="w-customize__section" aria-labelledby="w-board-look-icon">
      <h3 id="w-board-look-icon" className="w-customize__label">
        {t('boardLook.icon')}
      </h3>
      <div className="w-board-look__icons" role="radiogroup" aria-labelledby="w-board-look-icon" onKeyDown={walkRadios}>
        <div className="w-board-look__row">
          {radio(null, t('boardLook.noIcon'), null)}
          {emoji.map((e) => radio(e, e, <span className="w-board-glyph">{e}</span>))}
        </div>
        <div className="w-board-look__row" role="group" aria-label={t('boardLook.lineIcons')}>
          {BOARD_ICONS.map((name) => radio(name, t(`boardLook.icons.${name}`), <IconBoardGlyph name={name} />))}
        </div>
      </div>
      <div className="w-board-look__other">
        <label htmlFor="w-board-look-emoji" className="w-customize__rowlabel">
          {t('boardLook.otherEmoji')}
        </label>
        <input
          id="w-board-look-emoji"
          className="w-input"
          autoComplete="off"
          spellCheck={false}
          maxLength={64}
          placeholder={t('boardLook.otherEmojiPlaceholder')}
          aria-invalid={invalid || undefined}
          aria-describedby="w-board-look-emoji-note"
          value={typed}
          onChange={(e) => {
            const found = emojiIn(e.target.value);
            if (found) {
              choose(found);
              setTyped('');
            } else setTyped(e.target.value);
          }}
          onBlur={() => setTyped('')}
        />
      </div>
      <p id="w-board-look-emoji-note" className={invalid ? 'w-customize__hint w-customize__error' : 'w-customize__hint'} role={invalid ? 'alert' : undefined}>
        {invalid ? t('boardLook.emojiInvalid') : t('boardLook.emojiHint')}
      </p>
    </section>
  );
}

/** None, the palette (no uva: it is the agents') and any colour from the system picker. */
function ColourChoice({ id, label, hint, value, onPreview, onSave }: { id: string; label: string; hint?: string; value: string | null; onPreview: (c: string | undefined) => void; onSave: (c: string | null) => void }) {
  const t = useTranslations('app');
  const picker = useRef<HTMLInputElement>(null);
  const name = colorName(value);
  const custom = !!value && !name;

  const picked = useEffectEvent(() => {
    const v = picker.current?.value;
    onPreview(undefined);
    if (v && /^#[0-9a-f]{6}$/.test(v) && v !== value) onSave(v);
  });
  useEffect(() => {
    const el = picker.current;
    if (!el) return;
    const onChange = () => picked();
    el.addEventListener('change', onChange);
    return () => el.removeEventListener('change', onChange);
  }, []);

  const pick = (c: string | null) => {
    onPreview(undefined);
    if (c !== value) onSave(c);
  };
  return (
    <section className="w-customize__section" aria-labelledby={id}>
      <h3 id={id} className="w-customize__label">
        {label}
      </h3>
      <div className="w-swatches w-customize__swatches" role="radiogroup" aria-labelledby={id}>
        <button type="button" role="radio" aria-checked={value === null} className="w-swatch w-swatch--none" aria-label={t('noColor')} title={t('noColor')} onClick={() => pick(null)} />
        {PALETTE.map((c) => (
          <button key={c.name} type="button" role="radio" aria-checked={name === c.name} className="w-swatch" data-cor={c.name} aria-label={t(`colors.${c.name}`)} title={t(`colors.${c.name}`)} onClick={() => pick(c.hex)} />
        ))}
        <label className="w-swatch w-swatch--custom" data-checked={custom || undefined} style={custom ? { background: value } : undefined} title={t('customize.anyColor')}>
          <input ref={picker} type="color" className="w-sr" aria-label={`${label}: ${t('customize.anyColor')}`} value={value ?? '#5b6cf0'} onChange={(e) => onPreview(e.target.value)} />
        </label>
      </div>
      {hint && <p className="w-customize__hint">{hint}</p>}
    </section>
  );
}
