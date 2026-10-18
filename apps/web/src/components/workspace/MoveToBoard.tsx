'use client';

import { dropTargetForElements, monitorForElements, type ElementDragPayload } from '@atlaskit/pragmatic-drag-and-drop/adapter/element-adapter';
import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine';
import type { BoardDto, LaneDto } from '@noergo/core/dto';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useWorkspace } from './context';
import { boardsOf, colorName } from './model';
import type { WorkspaceStore } from './store';

/** The thought being dragged (a column by its header, or a card), if that is what moves. */
function draggedLane(store: WorkspaceStore, source: ElementDragPayload): LaneDto | undefined {
  const { type, id } = source.data;
  if ((type !== 'lane' && type !== 'tile') || typeof id !== 'string') return undefined;
  return store.getState().data?.lanes.get(id);
}

/**
 * A board's tab, which takes a thought dropped on it: the thought goes to the end of that
 * board, with its notes, and the person stays where they were.
 */
export function BoardTab({ board, current, onSelect, onRename }: { board: BoardDto; current: boolean; onSelect: () => void; onRename: () => void }) {
  const { store, actions } = useWorkspace();
  const ref = useRef<HTMLButtonElement>(null);
  const [ready, setReady] = useState(false);
  const [over, setOver] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const accepts = (source: ElementDragPayload) => {
      const lane = draggedLane(store, source);
      return !!lane && lane.boardId !== board.id;
    };
    return combine(
      dropTargetForElements({
        element: el,
        canDrop: ({ source }) => accepts(source),
        getData: () => ({ type: 'board', id: board.id }),
        onDragEnter: () => setOver(true),
        onDragLeave: () => setOver(false),
        onDrop: ({ source }) => {
          setOver(false);
          const lane = draggedLane(store, source);
          if (lane) actions.moveLaneToBoard(lane.id, board.id);
        },
      }),
      monitorForElements({
        canMonitor: ({ source }) => accepts(source),
        onDragStart: () => setReady(true),
        onDrop: () => setReady(false),
      }),
    );
  }, [store, actions, board.id]);

  return (
    <button
      ref={ref}
      type="button"
      className="w-board-tab"
      data-cor={colorName(board.color)}
      data-drop={over ? 'over' : ready ? 'ready' : undefined}
      aria-current={current ? 'page' : undefined}
      onClick={onSelect}
      onDoubleClick={onRename}
    >
      {board.title}
    </button>
  );
}

/** The other boards, as items of a thought's menu: choosing one moves the thought there. */
export function MoveToBoard({ lane, close }: { lane: LaneDto; close: () => void }) {
  const t = useTranslations('app');
  const { store, actions } = useWorkspace();
  const boards = useSyncExternalStore(
    store.subscribe,
    () => store.getState().data?.boards,
    () => undefined,
  );
  const others = boards ? boardsOf(boards).filter((b) => b.id !== lane.boardId) : [];
  return (
    <div className="w-menu__group" role="group" aria-label={t('moveToBoard')}>
      <div className="w-menu__label" aria-hidden="true">
        {t('moveToBoard')}
      </div>
      {others.length === 0 ? (
        <p className="w-menu__hint">{t('moveToBoardNone')}</p>
      ) : (
        others.map((b) => (
          <button
            key={b.id}
            type="button"
            className="w-menu__item w-menu__item--board"
            data-cor={colorName(b.color)}
            onClick={() => {
              close();
              actions.moveLaneToBoard(lane.id, b.id);
            }}
          >
            <span className="w-menu__text">{b.title}</span>
          </button>
        ))
      )}
    </div>
  );
}
