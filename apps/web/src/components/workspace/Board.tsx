'use client';

import { monitorForElements } from '@atlaskit/pragmatic-drag-and-drop/adapter/element-adapter';
import { autoScrollForElements } from '@atlaskit/pragmatic-drag-and-drop-auto-scroll/element';
import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine';
import { extractClosestEdge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge/extract-closest-edge';
import { LIMITS } from '@noergo/core/limits';
import { useTranslations } from 'next-intl';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useWorkspace } from './context';
import { IconPlus } from './icons';
import { Lane } from './Lane';
import { lanesOf, notesByLane, type Data } from './model';
import { columnTrees } from './tree';
import { InlineEdit, ViewFoot, ZoomSlider } from './ui';
import { anchoredScroll, COLUMNS, COLUMNS_ZOOM, columnsZoom } from './view-prefs';

/**
 * The columns of one board, side by side. Drops of notes and columns land here. The slider
 * at the bottom (or a pinch) scales them, from 50 % to 150 %, with CSS zoom on each column.
 */
export function Board({ data, boardId, hideDone }: { data: Data; boardId: string; hideDone: boolean }) {
  const t = useTranslations('app');
  const { actions } = useWorkspace();
  const scroller = useRef<HTMLDivElement>(null);
  const [adding, setAdding] = useState(false);
  const { lanes: laneMap, notes: noteMap, links } = data;
  const lanes = useMemo(() => lanesOf(laneMap, boardId), [laneMap, boardId]);
  const byLane = useMemo(
    () => notesByLane(noteMap, lanes.map((l) => l.id)),
    [noteMap, lanes],
  );
  const trees = useMemo(() => columnTrees({ notes: noteMap, links }, byLane), [noteMap, links, byLane]);
  const noteCount = useMemo(() => {
    let n = 0;
    for (const list of byLane.values()) n += hideDone ? list.filter((x) => x.doneAt === null).length : list.length;
    return n;
  }, [byLane, hideDone]);
  const zoom = COLUMNS_ZOOM.use();
  // The scroll to restore once the new size is laid out, so what was under the pointer stays.
  const anchor = useRef<{ at: number; scroll: number; ratio: number } | null>(null);

  const zoomTo = (next: number, at = 0) => {
    const el = scroller.current;
    const from = COLUMNS_ZOOM.read();
    const to = columnsZoom(next);
    if (!el || to === from) return;
    anchor.current = { at, scroll: el.scrollLeft, ratio: to / from };
    COLUMNS_ZOOM.write(to);
  };

  useLayoutEffect(() => {
    const el = scroller.current;
    const a = anchor.current;
    anchor.current = null;
    if (el && a) el.scrollLeft = anchoredScroll(a.scroll, a.at, a.ratio);
  }, [zoom]);

  // A pinch on a trackpad arrives as a wheel with Ctrl; it must not zoom the whole page.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const k = e.deltaMode === 1 ? 16 : 1;
      zoomTo(COLUMNS_ZOOM.read() * Math.exp(-e.deltaY * k * 0.01), e.clientX - el.getBoundingClientRect().left);
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
        canMonitor: ({ source }) => source.data.type === 'note' || source.data.type === 'lane',
        onDrop: ({ source, location }) => {
          const targets = location.current.dropTargets;
          const id = source.data.id as string;
          if (source.data.type === 'note') {
            const target = targets[0];
            if (!target) return;
            if (target.data.type === 'note') {
              const edge = extractClosestEdge(target.data);
              actions.moveNoteNear(id, target.data.id as string, edge === 'top' ? 'top' : 'bottom', target.data.open === true);
            } else {
              // On the column but not on a note: the end of that column, at the top level.
              const laneId = target.data.laneId as string;
              actions.moveNote(id, { laneId, index: Number.MAX_SAFE_INTEGER });
            }
          } else {
            const target = targets.find((x) => x.data.type === 'lane');
            if (!target) return;
            const edge = extractClosestEdge(target.data);
            actions.moveLaneNear(id, target.data.id as string, edge === 'left' ? 'left' : 'right');
          }
        },
      }),
    );
  }, [actions]);

  return (
    <div className="w-view">
      <div ref={scroller} className="w-board" role="region" aria-label={t('boardRegion')} style={{ '--board-z': zoom } as CSSProperties}>
        {lanes.map((lane, i) => (
          <Lane key={lane.id} lane={lane} notes={byLane.get(lane.id) ?? []} tree={trees.get(lane.id)!} hideDone={hideDone} index={i} total={lanes.length} />
        ))}
        <div className="w-lane w-lane--new">
          {adding ? (
            <InlineEdit
              value=""
              label={t('columnName')}
              placeholder={t('columnName')}
              maxLength={LIMITS.laneTitle}
              onSave={(title) => {
                actions.createLane(boardId, title);
                setAdding(false);
                requestAnimationFrame(() =>
                  scroller.current?.scrollTo({
                    left: scroller.current.scrollWidth,
                    behavior: 'smooth',
                  }),
                );
              }}
              onCancel={() => setAdding(false)}
            />
          ) : (
            <button type="button" className="nr-btn nr-btn--fantasma w-lane__add" onClick={() => setAdding(true)}>
              <IconPlus />
              {t('newColumn')}
            </button>
          )}
        </div>
        {lanes.length === 0 && !adding && (
          <div className="nr-vazio w-board__empty">
            <strong>{t('emptyBoard')}</strong>
            <span>{t('emptyBoardHint')}</span>
          </div>
        )}
      </div>
      <ViewFoot lanes={lanes.length} notes={noteCount}>
        <ZoomSlider
          label={t('zoom.columns')}
          value={zoom}
          min={COLUMNS.min}
          max={COLUMNS.max}
          step={COLUMNS.step}
          valueText={`${Math.round(zoom * 100)}%`}
          onChange={(z) => zoomTo(z)}
          onStep={(d) => zoomTo(Math.round((zoom + d * 0.1) * 10) / 10)}
        />
      </ViewFoot>
    </div>
  );
}
