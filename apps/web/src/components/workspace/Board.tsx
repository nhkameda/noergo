'use client';

import { monitorForElements } from '@atlaskit/pragmatic-drag-and-drop/adapter/element-adapter';
import { autoScrollForElements } from '@atlaskit/pragmatic-drag-and-drop-auto-scroll/element';
import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine';
import { extractClosestEdge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge/extract-closest-edge';
import { LIMITS } from '@noergo/core/limits';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useWorkspace } from './context';
import { IconPlus } from './icons';
import { Lane } from './Lane';
import { lanesOf, notesByLane, type Data } from './model';
import { InlineEdit } from './ui';

/** The columns of one board, side by side. Drops of notes and columns land here. */
export function Board({ data, boardId, hideDone }: { data: Data; boardId: string; hideDone: boolean }) {
  const t = useTranslations('app');
  const { actions } = useWorkspace();
  const scroller = useRef<HTMLDivElement>(null);
  const [adding, setAdding] = useState(false);
  const { lanes: laneMap, notes: noteMap } = data;
  const lanes = useMemo(() => lanesOf(laneMap, boardId), [laneMap, boardId]);
  const byLane = useMemo(
    () => notesByLane(noteMap, lanes.map((l) => l.id)),
    [noteMap, lanes],
  );

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
              actions.moveNoteNear(id, target.data.id as string, edge === 'top' ? 'top' : 'bottom');
            } else {
              // On the column but not on a note: the end of that column.
              const laneId = target.data.laneId as string;
              actions.moveNote(id, laneId, Number.MAX_SAFE_INTEGER);
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
    <div ref={scroller} className="w-board" role="region" aria-label={t('boardRegion')}>
      {lanes.map((lane, i) => (
        <Lane key={lane.id} lane={lane} notes={byLane.get(lane.id) ?? []} hideDone={hideDone} index={i} total={lanes.length} />
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
              requestAnimationFrame(() => scroller.current?.scrollTo({ left: scroller.current.scrollWidth, behavior: 'smooth' }));
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
  );
}
