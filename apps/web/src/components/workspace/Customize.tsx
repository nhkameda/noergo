'use client';

import type { LaneDto } from '@noergo/core/dto';
import { LIMITS } from '@noergo/core/limits';
import { useTranslations } from 'next-intl';
import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { useWorkspace } from './context';
import { CoverArt } from './CoverArt';
import { clampZoom, corProps, FRAME_DEFAULT, panFrame, sameColor, sliderToZoom, zoomToSlider, type Frame } from './cover';
import { abandonCover, analyze, clearPreview, firstImage, peekPreview, setPreview, takePicture, uploadingCover, useImageDrop, useLaneLook, type CoverLook } from './cover-client';
import { IconClose, IconGlobe, IconImage, IconMinus, IconPlus, IconSwap, IconTrash } from './icons';
import { colorName, PALETTE, type Data } from './model';
import { siteUrl } from './site';

export interface CustomizeTarget {
  laneId: string;
  anchor: DOMRect;
}

const ACCEPT = 'image/png,image/jpeg,image/webp,image/gif';
const WHITE = '#ffffff';
const INK = '#142b45';
/** A burst of zoom steps or arrow presses is saved as one change. */
const SETTLE_MS = 350;

/**
 * Everything that makes a column recognisable, in one place: its name, its description, its
 * website, the cover (dropped, pasted or chosen, then dragged into place and zoomed) and the colour (the
 * picture's own, the palette or any other). Every change shows at once in the column, its
 * card and its map; each one is a single undo step.
 */
export function CustomizePanel({ data, target, onClose }: { data: Data; target: CustomizeTarget; onClose: () => void }) {
  const t = useTranslations('app');
  const { actions, store } = useWorkspace();
  const laneId = target.laneId;
  const lane = data.lanes.get(laneId);
  const look = useLaneLook(lane);
  const panel = useRef<HTMLDivElement>(null);
  const chooser = useRef<HTMLInputElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const [found, setFound] = useState<{ src: string; bg: string | null; colors: string[] } | null>(null);

  const close = () => panel.current?.hidePopover();
  const take = (file: File | null) => {
    if (!file) return store.notify({ tone: 'error', key: 'coverNotImage' });
    void takePicture(laneId, file, actions, store);
  };
  const drop = useImageDrop(take, () => take(null));

  // Opens beside what was clicked (or dropped on), so the column stays in sight while it
  // changes; below it when there is no room at the sides. On a phone it is a bottom sheet.
  useLayoutEffect(() => {
    if (panel.current) openPanel(panel.current, target.anchor, 'beside');
  }, [target.anchor]);

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

  // ⌘V of a screenshot while the panel is open.
  const pasted = useEffectEvent((e: ClipboardEvent) => {
    const file = firstImage(e.clipboardData);
    if (!file) return;
    e.preventDefault();
    take(file);
  });
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => pasted(e);
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, []);

  // The colours of the picture, to offer them first.
  const src = look.cover?.src;
  useEffect(() => {
    if (!src || found?.src === src) return;
    let live = true;
    const img = new Image();
    img.src = src;
    img
      .decode()
      .then(() => {
        if (live) setFound({ src, ...analyze(img, img.naturalWidth, img.naturalHeight) });
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [src, found?.src]);

  // The native colour picker reports while it is dragged; the column follows, and the
  // colour is saved when the picker lets go.
  const picked = useEffectEvent(() => {
    const value = picker.current?.value;
    clearPreview(laneId, 'color');
    if (value && /^#[0-9a-f]{6}$/.test(value)) actions.updateLane(laneId, { color: value });
  });
  useEffect(() => {
    const el = picker.current;
    if (!el) return;
    const onChange = () => picked();
    el.addEventListener('change', onChange);
    return () => el.removeEventListener('change', onChange);
  }, []);

  if (!lane) return null;

  const paint = (color: string | null) => {
    clearPreview(laneId, 'color');
    actions.updateLane(laneId, { color });
  };
  /**
   * Saves the framing on screen with `patch` over it — all of it, so a zoom still waiting
   * to settle is not undone by a drag that lands first. While the picture is still
   * travelling, its arrival saves the latest.
   */
  const commit = (patch: Partial<Frame & { bg: string | null }>) => {
    const cur = store.getState().data?.lanes.get(laneId)?.cover;
    if (!cur || uploadingCover(laneId)) return;
    const shown = peekPreview(laneId)?.cover;
    const next = { ...cur, ...(shown ? { x: shown.x, y: shown.y, z: shown.z, bg: shown.bg } : {}), ...patch };
    if (next.x !== cur.x || next.y !== cur.y || next.z !== cur.z || next.bg !== cur.bg) actions.setCover(laneId, next);
    clearPreview(laneId, 'cover');
  };
  const remove = () => {
    if (uploadingCover(laneId)) abandonCover(laneId);
    if (store.getState().data?.lanes.get(laneId)?.cover) actions.setCover(laneId, null);
  };

  const color = look.color;
  const name = colorName(color);
  const custom = !!color && !name;
  // The column's own colour stands in for the one of the picture it came from.
  const fromImage = ((found?.src === src ? found?.colors : undefined) ?? []).map((c) => (sameColor(c, color) ? color! : c));
  const edge = found?.src === src ? found?.bg : null;
  const backgrounds = [...new Set([edge, WHITE, INK].filter((c): c is string => !!c))];

  const bg = (c: string | null) => {
    if (!look.cover) return;
    setPreview(laneId, { cover: { ...look.cover, bg: c } });
    commit({ bg: c });
  };

  return (
    <div ref={panel} popover="auto" className="w-customize" role="dialog" aria-labelledby="w-customize-kicker w-customize-title" data-lane={laneId}>
      <header className="w-customize__head">
        <div className="w-customize__names">
          <h2 id="w-customize-kicker" className="w-customize__kicker">
            {t('customize.kicker')}
          </h2>
          <NameField id="w-customize-title" value={lane.title} label={t('customize.name')} maxLength={LIMITS.laneTitle} onSave={(title) => actions.updateLane(lane.id, { title })} />
        </div>
        <button type="button" className="w-icon-btn" onClick={close} aria-label={t('customize.close')} title={t('customize.close')}>
          <IconClose />
        </button>
      </header>

      <section className="w-customize__section">
        <label htmlFor="w-customize-description" className="w-customize__label">
          {t('customize.description')}
        </label>
        <DescriptionField id="w-customize-description" lane={lane} />
      </section>

      <SiteField lane={lane} />

      <section className="w-customize__section" aria-labelledby="w-customize-cover">
        <h3 id="w-customize-cover" className="w-customize__label">
          {t('customize.cover')}
        </h3>
        {look.cover ? (
          <>
            <div className="w-customize__frame" {...drop.props} data-over={drop.over || undefined} style={laneBehind(color)}>
              <CoverEditor laneId={laneId} look={look.cover} onCommit={commit} />
              {look.uploading && <span className="w-customize__busy">{t('customize.uploading')}</span>}
            </div>
            <p className="w-customize__hint">{t('customize.adjustHint')}</p>
            <ZoomRow laneId={laneId} look={look.cover} onCommit={commit} />
            <div className="w-customize__row" role="radiogroup" aria-label={t('customize.background')}>
              <span className="w-customize__rowlabel">{t('customize.background')}</span>
              <button type="button" role="radio" aria-checked={look.cover.bg === null} className="w-swatch w-swatch--clear" aria-label={t('customize.bgNone')} title={t('customize.bgNone')} onClick={() => bg(null)} />
              {backgrounds.map((c) => (
                <button key={c} type="button" role="radio" aria-checked={look.cover?.bg === c} className="w-swatch w-swatch--flat" style={{ background: c }} aria-label={c === WHITE ? t('customize.bgWhite') : c === INK ? t('customize.bgDark') : t('customize.bgEdge')} title={c === WHITE ? t('customize.bgWhite') : c === INK ? t('customize.bgDark') : t('customize.bgEdge')} onClick={() => bg(c)} />
              ))}
            </div>
            <div className="w-customize__row w-customize__row--actions">
              <button type="button" className="nr-btn nr-btn--sm nr-btn--fantasma" onClick={() => chooser.current?.click()}>
                <IconSwap />
                {t('customize.replace')}
              </button>
              <button type="button" className="nr-btn nr-btn--sm nr-btn--fantasma w-customize__danger" onClick={remove}>
                <IconTrash />
                {t('customize.remove')}
              </button>
            </div>
          </>
        ) : (
          <div className="w-customize__drop" {...drop.props} data-over={drop.over || undefined}>
            <IconImage />
            <strong>{t('customize.dropTitle')}</strong>
            <span>{t('customize.dropHint')}</span>
            <button type="button" className="nr-btn nr-btn--sm" onClick={() => chooser.current?.click()}>
              {t('customize.choose')}
            </button>
          </div>
        )}
        <input
          ref={chooser}
          type="file"
          accept={ACCEPT}
          hidden
          onChange={(e) => {
            take(e.target.files?.[0] ?? null);
            e.target.value = '';
          }}
        />
      </section>

      <section className="w-customize__section" aria-labelledby="w-customize-color">
        <h3 id="w-customize-color" className="w-customize__label">
          {t('customize.color')}
        </h3>
        {fromImage.length > 0 && (
          <div className="w-customize__row" role="radiogroup" aria-label={t('customize.fromImage')}>
            <span className="w-customize__rowlabel">{t('customize.fromImage')}</span>
            {fromImage.map((c) => (
              <button key={c} type="button" role="radio" aria-checked={color === c} className="w-swatch" {...corProps(c)} aria-label={t('customize.imageColor', { color: c })} title={c} onClick={() => paint(c)} />
            ))}
          </div>
        )}
        <div className="w-swatches w-customize__swatches" role="radiogroup" aria-label={t('customize.color')}>
          <button type="button" role="radio" aria-checked={color === null} className="w-swatch w-swatch--none" aria-label={t('noColor')} title={t('noColor')} onClick={() => paint(null)} />
          {PALETTE.map((c) => (
            <button key={c.name} type="button" role="radio" aria-checked={name === c.name} className="w-swatch" data-cor={c.name} aria-label={t(`colors.${c.name}`)} title={t(`colors.${c.name}`)} onClick={() => paint(c.hex)} />
          ))}
          <label className="w-swatch w-swatch--custom" data-checked={custom || undefined} style={custom ? { background: color } : undefined} title={t('customize.anyColor')}>
            <input
              ref={picker}
              type="color"
              className="w-sr"
              aria-label={t('customize.anyColor')}
              value={color ?? '#5b6cf0'}
              onChange={(e) => setPreview(laneId, { color: e.target.value })}
            />
          </label>
        </div>
      </section>

      <footer className="w-customize__foot">
        <button type="button" className="nr-btn nr-btn--sm nr-btn--primario" onClick={close}>
          {t('customize.done')}
        </button>
      </footer>
    </div>
  );
}

/**
 * Shows a customise panel next to `a`: at its side when there is room (`beside`), else
 * under it, else over it. A tab at the top of the screen asks for `below`.
 */
export function openPanel(p: HTMLElement, a: DOMRect, prefer: 'beside' | 'below') {
  if (!p.matches(':popover-open')) p.showPopover();
  // Measured at the full height it may take: its max-height follows --y.
  p.style.setProperty('--y', '8px');
  const w = p.offsetWidth;
  const h = p.offsetHeight;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const gap = 12;
  const clampX = (x: number) => Math.max(8, Math.min(x, vw - w - 8));
  const clampY = (y: number) => Math.max(8, Math.min(y, vh - h - 8));
  let left: number;
  let top: number;
  if (prefer === 'below') [left, top] = [clampX(a.left), clampY(a.bottom + 8)];
  else if (a.right + gap + w <= vw - 8) [left, top] = [a.right + gap, clampY(a.top)];
  else if (a.left - gap - w >= 8) [left, top] = [a.left - gap - w, clampY(a.top)];
  else {
    left = clampX(a.right - w);
    top = a.bottom + 8 + h <= vh - 8 ? a.bottom + 8 : clampY(a.top - h - 8);
  }
  p.style.setProperty('--x', `${left}px`);
  p.style.setProperty('--y', `${top}px`);
}

/** A name, saved when it is left (Enter, Tab, a click elsewhere); Escape puts it back. */
export function NameField({ id, value, label, maxLength, onSave }: { id: string; value: string; label: string; maxLength: number; onSave: (title: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const save = () => {
    const title = draft?.trim();
    if (title && title !== value) onSave(title);
    setDraft(null);
  };
  return (
    <input
      id={id}
      className="w-input w-customize__name"
      aria-label={label}
      maxLength={maxLength}
      autoComplete="off"
      value={draft ?? value}
      onFocus={() => setDraft(value)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          e.currentTarget.blur();
        } else if (e.key === 'Escape' && draft !== value) {
          // The first Escape undoes the typing; the next one closes the panel.
          e.preventDefault();
          e.stopPropagation();
          setDraft(value);
        }
      }}
    />
  );
}

/**
 * The thought's website, typed the way people say it ("example.com"). It is saved when the
 * field is left; a blank field removes it; something that is not a web address stays in
 * the field with a note, and nothing is saved.
 */
/**
 * A thought's description, a few lines under its title: saved when the field is left, Esc
 * undoes the typing first (then closes the panel), Enter makes a new line.
 */
export function DescriptionField({ id, lane, className = 'w-input w-description-field' }: { id: string; lane: LaneDto; className?: string }) {
  const t = useTranslations('app');
  const { actions } = useWorkspace();
  const [draft, setDraft] = useState<string | null>(null);
  const save = () => {
    if (draft === null) return;
    const description = draft.trim();
    if (description !== lane.description) actions.updateLane(lane.id, { description });
    setDraft(null);
  };
  return (
    <textarea
      id={id}
      className={className}
      rows={3}
      maxLength={LIMITS.laneDescription}
      aria-label={t('customize.description')}
      placeholder={t('customize.descriptionPlaceholder')}
      value={draft ?? lane.description}
      onFocus={() => setDraft((d) => d ?? lane.description)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && draft !== null && draft !== lane.description) {
          e.preventDefault();
          e.stopPropagation();
          setDraft(lane.description);
        }
      }}
    />
  );
}

function SiteField({ lane }: { lane: LaneDto }) {
  const t = useTranslations('app');
  const { actions } = useWorkspace();
  const [draft, setDraft] = useState<string | null>(null);
  const typed = draft?.trim() ?? '';
  const invalid = draft !== null && typed !== '' && !siteUrl(typed);
  const save = () => {
    if (draft === null || invalid) return;
    const url = typed ? siteUrl(typed) : null;
    if (url !== lane.url) actions.updateLane(lane.id, { url });
    setDraft(null);
  };
  return (
    <section className="w-customize__section">
      <label htmlFor="w-customize-site" className="w-customize__label">
        {t('customize.site')}
      </label>
      <div className="w-customize__site">
        <input
          id="w-customize-site"
          className="w-input"
          inputMode="url"
          autoComplete="url"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={LIMITS.url}
          placeholder={t('customize.sitePlaceholder')}
          aria-invalid={invalid || undefined}
          aria-describedby="w-customize-site-note"
          value={draft ?? lane.url ?? ''}
          onFocus={() => setDraft((d) => d ?? lane.url ?? '')}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              e.currentTarget.blur();
            }
          }}
        />
        {lane.url && draft === null && (
          <a className="nr-btn nr-btn--sm nr-btn--fantasma" href={lane.url} target="_blank" rel="noopener noreferrer nofollow ugc">
            <IconGlobe />
            {t('customize.siteOpen')}
          </a>
        )}
      </div>
      <p id="w-customize-site-note" className={invalid ? 'w-customize__hint w-customize__error' : 'w-customize__hint'}>
        {invalid ? t('customize.siteInvalid') : t('customize.siteHint')}
      </p>
    </section>
  );
}

/** What shows through a cover without a background: the column's colour. */
const laneBehind = (color: string | null) => (color ? { background: color } : undefined);

/** Debounced save, flushed when the panel goes away. */
function useSettle(onCommit: (patch: Partial<Frame>) => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latest = useRef<Partial<Frame> | null>(null);
  const commit = useRef(onCommit);
  useLayoutEffect(() => {
    commit.current = onCommit;
  });
  const flush = useRef(() => {
    clearTimeout(timer.current);
    const p = latest.current;
    latest.current = null;
    if (p) commit.current(p);
  });
  useEffect(() => {
    const f = flush.current;
    return () => f();
  }, []);
  return (patch: Partial<Frame>) => {
    latest.current = patch;
    clearTimeout(timer.current);
    timer.current = setTimeout(flush.current, SETTLE_MS);
  };
}

/**
 * The picture in its frame, to be dragged into place. Wheel or pinch zooms, arrows move,
 * double-click centres it again.
 */
function CoverEditor({ laneId, look, onCommit }: { laneId: string; look: CoverLook; onCommit: (patch: Partial<Frame>) => void }) {
  const t = useTranslations('app');
  const frame = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; from: CoverLook; last: Frame | null } | null>(null);
  const settle = useSettle(onCommit);
  const show = (f: Frame) => setPreview(laneId, { cover: { ...look, ...f } });

  const wheel = useEffectEvent((e: WheelEvent) => {
    e.preventDefault();
    const z = clampZoom(look.z * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.002)));
    show({ x: look.x, y: look.y, z });
    settle({ z });
  });
  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => wheel(e);
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // the pointer is already gone
    }
    drag.current = { x: e.clientX, y: e.clientY, from: look, last: null };
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || !frame.current) return;
    const f = panFrame(d.from, e.clientX - d.x, e.clientY - d.y, frame.current.clientWidth);
    d.last = f;
    show(f);
  };
  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (d?.last) onCommit({ x: d.last.x, y: d.last.y });
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 0.1 : 0.025;
    const moves: Record<string, [number, number]> = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    const m = moves[e.key];
    let f: Frame | null = null;
    if (m) f = { x: Math.min(1, Math.max(0, look.x + m[0])), y: Math.min(1, Math.max(0, look.y + m[1])), z: look.z };
    else if (e.key === '+' || e.key === '=') f = { ...look, z: clampZoom(look.z * 1.15) };
    else if (e.key === '-') f = { ...look, z: clampZoom(look.z / 1.15) };
    else if (e.key === '0') f = FRAME_DEFAULT;
    if (!f) return;
    e.preventDefault();
    show(f);
    settle({ x: f.x, y: f.y, z: f.z });
  };

  return (
    <div
      ref={frame}
      className="w-customize__editor"
      tabIndex={0}
      role="group"
      aria-label={t('customize.position')}
      aria-roledescription={t('customize.positionRole')}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
      onDoubleClick={() => {
        show(FRAME_DEFAULT);
        onCommit(FRAME_DEFAULT);
      }}
    >
      <CoverArt look={look} />
    </div>
  );
}

function ZoomRow({ laneId, look, onCommit }: { laneId: string; look: CoverLook; onCommit: (patch: Partial<Frame>) => void }) {
  const t = useTranslations('app');
  const settle = useSettle(onCommit);
  const zoom = (z: number) => {
    const v = clampZoom(z);
    setPreview(laneId, { cover: { ...look, z: v } });
    settle({ z: v });
  };
  return (
    <div className="w-customize__zoom">
      <button type="button" className="w-icon-btn" onClick={() => zoom(look.z / 1.25)} aria-label={t('customize.smaller')} title={t('customize.smaller')}>
        <IconMinus />
      </button>
      <input type="range" min={0} max={1000} step={1} value={Math.round(zoomToSlider(look.z) * 1000)} aria-label={t('customize.size')} aria-valuetext={`${Math.round(look.z * 100)}%`} onChange={(e) => zoom(sliderToZoom(Number(e.target.value) / 1000))} />
      <button type="button" className="w-icon-btn" onClick={() => zoom(look.z * 1.25)} aria-label={t('customize.larger')} title={t('customize.larger')}>
        <IconPlus />
      </button>
    </div>
  );
}
