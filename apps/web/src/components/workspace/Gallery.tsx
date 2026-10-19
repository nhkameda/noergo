'use client';

import { draggable, dropTargetForElements, monitorForElements } from '@atlaskit/pragmatic-drag-and-drop/adapter/element-adapter';
import { autoScrollForElements } from '@atlaskit/pragmatic-drag-and-drop-auto-scroll/element';
import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine';
import { attachClosestEdge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge/attach-closest-edge';
import { extractClosestEdge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge/extract-closest-edge';
import type { Edge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/types';
import type { LaneDto } from '@noergo/core/dto';
import { LIMITS } from '@noergo/core/limits';
import { useTranslations } from 'next-intl';
import { memo, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { agentProps, useAgentMark } from './agent-marks';
import { useWorkspace } from './context';
import { CoverArt } from './CoverArt';
import { initials, laneStyle } from './cover';
import { useFileDrag, useImageDrop, useLaneLook } from './cover-client';
import { IconBrush, IconImage, IconMap, IconPlus } from './icons';
import { lanesOf, notesByLane, type Data } from './model';
import { MoveToBoard } from './MoveToBoard';
import { InlineEdit, Menu, ViewFoot, ZoomSlider } from './ui';
import { CARDS, CARDS_PER_ROW, cardsThatFit, perRow } from './view-prefs';

/**
 * Every thought of a board as a card: its cover and its title, side by side, so fifty
 * thoughts fit on one screen. Drag to reorder, or onto another board's tab to move it
 * there; a click opens the thought among the columns, the map button its mind map. The
 * slider at the bottom (or a pinch) sets how many go in a row, like a photo library: six
 * unless the person chose otherwise, never more than fit at a readable size.
 */
export function Gallery({ data, boardId, hideDone, onOpen }: { data: Data; boardId: string; hideDone: boolean; onOpen: (laneId: string) => void }) {
  const t = useTranslations('app');
  const { actions } = useWorkspace();
  const scroller = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLOListElement>(null);
  const [adding, setAdding] = useState(false);
  const chosen = CARDS_PER_ROW.use();
  const [fit, setFit] = useState<number>(CARDS.max);
  const shown = Math.min(chosen, fit);
  const { lanes: laneMap, notes: noteMap } = data;
  const lanes = useMemo(() => lanesOf(laneMap, boardId), [laneMap, boardId]);
  const counts = useMemo(() => {
    const by = notesByLane(noteMap, lanes.map((l) => l.id));
    return new Map(lanes.map((l) => [l.id, (by.get(l.id) ?? []).filter((n) => !hideDone || n.doneAt === null).length]));
  }, [noteMap, lanes, hideDone]);
  const noteCount = useMemo(() => [...counts.values()].reduce((a, b) => a + b, 0), [counts]);

  // How many cards fit follows the width of the grid (a window, a phone, the drawer).
  useEffect(() => {
    const el = grid.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setFit(fitIn(el)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // A pinch on a trackpad (a wheel with Ctrl): apart for more cards a row, together for fewer.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    let pinched = 0;
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      pinched += e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      if (Math.abs(pinched) < 40) return;
      const now = Math.min(CARDS_PER_ROW.read(), grid.current ? fitIn(grid.current) : CARDS.max);
      CARDS_PER_ROW.write(perRow(now + Math.sign(pinched)));
      pinched = 0;
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, []);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    return combine(
      autoScrollForElements({ element: el }),
      monitorForElements({
        canMonitor: ({ source }) => source.data.type === 'tile',
        onDrop: ({ source, location }) => {
          const target = location.current.dropTargets.find((x) => x.data.type === 'tile');
          if (!target) return;
          actions.moveLaneNear(source.data.id as string, target.data.id as string, extractClosestEdge(target.data) === 'left' ? 'left' : 'right');
        },
      }),
    );
  }, [actions]);

  return (
    <div className="w-view">
      <div ref={scroller} className="w-gallery" role="region" aria-label={t('cards.region')}>
        <ol ref={grid} className="w-gallery__grid" style={{ '--per-row': shown } as CSSProperties}>
          {lanes.map((lane, i) => (
            <Tile key={lane.id} lane={lane} count={counts.get(lane.id) ?? 0} index={i} total={lanes.length} onOpen={onOpen} />
          ))}
          <li className="w-tile-slot w-tile-slot--new">
            {adding ? (
              <InlineEdit
                value=""
                label={t('columnName')}
                placeholder={t('columnName')}
                maxLength={LIMITS.laneTitle}
                onSave={(title) => {
                  actions.createLane(boardId, title);
                  setAdding(false);
                }}
                onCancel={() => setAdding(false)}
              />
            ) : (
              <button type="button" className="w-tile-new" onClick={() => setAdding(true)}>
                <IconPlus />
                <span className="w-tile-new__label">{t('newColumn')}</span>
              </button>
            )}
          </li>
        </ol>
        {lanes.length === 0 && !adding && (
          <div className="nr-vazio w-board__empty">
            <strong>{t('emptyBoard')}</strong>
            <span>{t('emptyBoardHint')}</span>
          </div>
        )}
      </div>
      <ViewFoot lanes={lanes.length} notes={noteCount}>
        {/* Backwards: to the right the cards grow, so fewer fit in a row. */}
        <ZoomSlider
          label={t('zoom.cards')}
          value={-shown}
          min={-fit}
          max={-CARDS.min}
          step={1}
          valueText={t('zoom.perRow', { count: shown })}
          onChange={(v) => CARDS_PER_ROW.write(perRow(-v))}
          onStep={(d) => CARDS_PER_ROW.write(perRow(Math.min(fit, shown - d)))}
        />
      </ViewFoot>
    </div>
  );
}

/** How many cards fit in a row of this grid. */
const fitIn = (grid: HTMLElement) => cardsThatFit(grid.clientWidth, parseFloat(getComputedStyle(grid).columnGap) || 0);

const Tile = memo(function Tile({ lane, count, index, total, onOpen }: { lane: LaneDto; count: number; index: number; total: number; onOpen: (laneId: string) => void }) {
  const t = useTranslations('app');
  const { actions, announce, customize, openMap, store } = useWorkspace();
  const look = useLaneLook(lane);
  const agent = useAgentMark(lane.id);
  const files = useFileDrag();
  const ref = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState<Edge | null>(null);
  const [dragging, setDragging] = useState(false);
  const anchor = () => ref.current!.getBoundingClientRect();
  const drop = useImageDrop(
    (file) => customize(lane.id, anchor(), file),
    () => store.notify({ tone: 'error', key: 'coverNotImage' }),
  );

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    return combine(
      draggable({
        element: el,
        getInitialData: () => ({ type: 'tile', id: lane.id }),
        onDragStart: () => setDragging(true),
        onDrop: () => setDragging(false),
      }),
      dropTargetForElements({
        element: el,
        canDrop: ({ source }) => source.data.type === 'tile' && source.data.id !== lane.id,
        getData: ({ input, element }) => attachClosestEdge({ type: 'tile', id: lane.id }, { input, element, allowedEdges: ['left', 'right'] }),
        onDrag: ({ self }) => setEdge(extractClosestEdge(self.data)),
        onDragLeave: () => setEdge(null),
        onDrop: () => setEdge(null),
      }),
    );
  }, [lane.id]);

  // Alt + arrows move the card, like a column's "move left / right".
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (!e.altKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
    e.preventDefault();
    const moved = actions.moveLane(lane.id, index + (e.key === 'ArrowLeft' ? -1 : 1));
    if (!moved) return;
    announce(t('a11y.movedColumn', { position: moved.index + 1, total: moved.total }));
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-lane-tile="${CSS.escape(lane.id)}"] .w-tile__open`)?.focus());
  };

  return (
    <li className="w-tile-slot" data-edge={edge ?? undefined}>
      <div ref={ref} className={`w-tile${dragging ? ' w-tile--dragging' : ''}`} {...laneStyle(look.color)} {...agentProps(agent)} data-lane-tile={lane.id} {...drop.props} data-over={drop.over || undefined}>
        <button type="button" className="w-tile__open" onClick={() => onOpen(lane.id)} onKeyDown={onKeyDown} aria-label={t('cards.open', { title: lane.title, count, position: index + 1, total })}>
          {look.cover ? (
            <CoverArt look={look.cover} className="w-tile__cover" />
          ) : (
            <span className="w-cover w-tile__cover w-tile__blank" aria-hidden="true">
              {initials(lane.title)}
            </span>
          )}
          <span className="w-tile__name">
            <span className="w-tile__title" title={lane.title}>
              {lane.title}
            </span>
            <span className="w-tile__count" aria-hidden="true">
              {count}
            </span>
          </span>
        </button>
        <button type="button" className="w-icon-btn w-tile__map" onClick={() => openMap(lane.id)} aria-label={t('map.openColumn', { title: lane.title })} title={t('map.open')}>
          <IconMap />
        </button>
        <div className="w-tile__tools">
          <button
            type="button"
            className="w-icon-btn w-tile__tool w-tile__brush"
            onClick={() => customize(lane.id, anchor())}
            aria-label={t('customize.open', { title: lane.title })}
            title={t('customize.openShort')}
          >
            <IconBrush />
          </button>
          <Menu label={t('columnMenu', { title: lane.title })} className="w-icon-btn w-tile__tool w-tile__more">
            {(close) => (
              <>
                <button type="button" className="w-menu__item" onClick={() => { close(); customize(lane.id, anchor()); }}>
                  {t('customize.menu')}
                </button>
                <MoveToBoard lane={lane} close={close} />
                <button type="button" className="w-menu__item w-menu__item--danger" onClick={() => { close(); actions.deleteLane(lane.id); }}>
                  {t('deleteColumn')}
                </button>
              </>
            )}
          </Menu>
        </div>
        {files && (
          <span className="w-drop-hint" aria-hidden="true">
            <IconImage />
            {t('customize.dropShort')}
          </span>
        )}
      </div>
    </li>
  );
});
