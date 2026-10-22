'use client';

import { monitorForElements } from '@atlaskit/pragmatic-drag-and-drop/adapter/element-adapter';
import { autoScrollForElements } from '@atlaskit/pragmatic-drag-and-drop-auto-scroll/element';
import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { IconChevronLeft, IconChevronRight } from './icons';

const TAB = '[data-board-tab]';

interface Sight {
  /** Tabs past the left edge, and past the right. */
  start: boolean;
  end: boolean;
  /** How many tabs are not wholly in sight, at either end. */
  hidden: number;
}

const motion = (): ScrollBehavior => (window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth');

/** Where the tabs show whole: inside the strip, less the arrows over its edges (`--w-arrow`). */
function span(el: HTMLElement, start: boolean, end: boolean) {
  const box = el.getBoundingClientRect();
  const arrow = parseFloat(getComputedStyle(el).getPropertyValue('--w-arrow')) || 0;
  return { from: box.left + (start ? arrow : 0), to: box.right - (end ? arrow : 0) };
}

/**
 * The boards' tabs, in a row that scrolls sideways when they do not fit. Each side with
 * tabs past it has an arrow that brings the next ones into sight; a mouse wheel scrolls it;
 * the open board's tab comes into sight by itself. `more` lists every board, told how many
 * are out of sight; on a wide screen it shows only while some are. `after` follows it.
 */
export function BoardStrip({
  label,
  current,
  stripRef,
  more,
  after,
  children,
}: {
  label: string;
  current: string | null;
  stripRef: RefObject<HTMLElement | null>;
  more: (hidden: number) => ReactNode;
  after: ReactNode;
  children: ReactNode;
}) {
  const t = useTranslations('app');
  const [sight, setSight] = useState<Sight>({ start: false, end: false, hidden: 0 });
  // While something is dragged the arrows let it through to the strip, which scrolls at its edges.
  const [dragging, setDragging] = useState(false);
  const shown = useRef(false);

  useEffect(() => {
    const el = stripRef.current;
    if (!el) return;
    const measure = () => {
      const start = el.scrollLeft > 1;
      const end = el.scrollLeft < el.scrollWidth - el.clientWidth - 1;
      const { from, to } = span(el, start, end);
      let hidden = 0;
      for (const tab of el.querySelectorAll(TAB)) {
        const r = tab.getBoundingClientRect();
        if (r.left < from - 1 || r.right > to + 1) hidden++;
      }
      setSight((s) => (s.start === start && s.end === end && s.hidden === hidden ? s : { start, end, hidden }));
    };
    // A tab added, renamed or given an icon changes what fits; so does the window.
    const resize = new ResizeObserver(measure);
    const watch = () => {
      resize.disconnect();
      resize.observe(el);
      for (const child of el.children) resize.observe(child);
      measure();
    };
    const added = new MutationObserver(watch);
    added.observe(el, { childList: true });
    watch();
    // A mouse wheel turns vertically; here that means sideways.
    const wheel = (e: WheelEvent) => {
      if (e.ctrlKey || Math.abs(e.deltaX) >= Math.abs(e.deltaY) || el.scrollWidth <= el.clientWidth) return;
      e.preventDefault();
      el.scrollLeft += e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    };
    el.addEventListener('scroll', measure, { passive: true });
    el.addEventListener('wheel', wheel, { passive: false });
    const off = combine(
      autoScrollForElements({ element: el }),
      monitorForElements({ onDragStart: () => setDragging(true), onDrop: () => setDragging(false) }),
    );
    return () => {
      off();
      resize.disconnect();
      added.disconnect();
      el.removeEventListener('scroll', measure);
      el.removeEventListener('wheel', wheel);
    };
  }, [stripRef]);

  // The open board's tab, whole and clear of the arrows: on arrival at once, then gliding.
  useEffect(() => {
    const el = stripRef.current;
    const tab = current ? el?.querySelector<HTMLElement>(`[data-board-tab="${CSS.escape(current)}"]`) : null;
    if (!el || !tab) return;
    const { from, to } = span(el, true, true);
    const r = tab.getBoundingClientRect();
    const by = r.left < from ? r.left - from : r.right > to ? Math.min(r.right - to, r.left - from) : 0;
    if (by) el.scrollBy({ left: by, behavior: shown.current ? motion() : 'auto' });
    shown.current = true;
  }, [current, stripRef]);

  // One arrow press: the first tab cut at that edge comes whole to the other one.
  const page = (dir: -1 | 1) => {
    const el = stripRef.current;
    if (!el) return;
    const { from, to } = span(el, sight.start, sight.end);
    const tabs = [...el.querySelectorAll(TAB)].map((x) => x.getBoundingClientRect());
    let by = dir * (to - from);
    if (dir > 0) {
      const next = tabs.find((r) => r.right > to + 1);
      if (next) by = next.left - span(el, true, true).from;
    } else {
      for (let i = tabs.length - 1; i >= 0; i--) {
        if (tabs[i]!.left >= from - 1) continue;
        by = tabs[i]!.right - span(el, true, true).to;
        break;
      }
    }
    el.scrollBy({ left: by, behavior: motion() });
  };

  return (
    <div className="w-tabs" data-overflow={sight.start || sight.end || undefined} data-dragging={dragging || undefined}>
      <div className="w-tabs__track">
        <nav ref={stripRef} className="w-boards" aria-label={label}>
          {children}
        </nav>
        {sight.start && (
          <button type="button" className="w-tabs__arrow" data-side="start" tabIndex={-1} aria-label={t('tabsBack')} title={t('tabsBack')} onClick={() => page(-1)}>
            <IconChevronLeft />
          </button>
        )}
        {sight.end && (
          <button type="button" className="w-tabs__arrow" data-side="end" tabIndex={-1} aria-label={t('tabsForward')} title={t('tabsForward')} onClick={() => page(1)}>
            <IconChevronRight />
          </button>
        )}
      </div>
      {more(sight.hidden)}
      {after}
    </div>
  );
}
