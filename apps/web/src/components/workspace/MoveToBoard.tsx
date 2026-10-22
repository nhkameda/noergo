'use client';

import { draggable, dropTargetForElements, monitorForElements, type ElementDragPayload } from '@atlaskit/pragmatic-drag-and-drop/adapter/element-adapter';
import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine';
import { attachClosestEdge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge/attach-closest-edge';
import { extractClosestEdge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge/extract-closest-edge';
import type { Edge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/types';
import type { BoardDto, LaneDto } from '@noergo/core/dto';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type KeyboardEvent } from 'react';
import { BoardGlyph, tabProps, useBoardLook } from './BoardLook';
import { useWorkspace } from './context';
import { corProps } from './cover';
import { IconCheck } from './icons';
import { boardsOf } from './model';
import type { WorkspaceStore } from './store';

/** The thought being dragged (a column by its header, or a card), if that is what moves. */
function draggedLane(store: WorkspaceStore, source: ElementDragPayload): LaneDto | undefined {
  const { type, id } = source.data;
  if ((type !== 'lane' && type !== 'tile') || typeof id !== 'string') return undefined;
  return store.getState().data?.lanes.get(id);
}

const isBoard = (source: ElementDragPayload) => source.data.type === 'board' && typeof source.data.id === 'string';

/**
 * A board's tab: its icon, its colour and its name. Dragged along the bar it changes
 * places (Alt + arrows do the same); a thought dropped on it goes to the end of that
 * board, with its notes, and the person stays where they were.
 */
export function BoardTab({ board, index, current, onSelect, onRename }: { board: BoardDto; index: number; current: boolean; onSelect: () => void; onRename: () => void }) {
  const t = useTranslations('app');
  const { store, actions, announce } = useWorkspace();
  const look = useBoardLook(board)!;
  const ref = useRef<HTMLButtonElement>(null);
  const [ready, setReady] = useState(false);
  const [over, setOver] = useState(false);
  const [edge, setEdge] = useState<Edge | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const takesLane = (source: ElementDragPayload) => {
      const lane = draggedLane(store, source);
      return !!lane && lane.boardId !== board.id;
    };
    const moved = (result: { index: number; total: number } | null, id: string) => {
      if (!result) return;
      announce(t('a11y.movedBoard', { position: result.index + 1, total: result.total }));
      requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-board-tab="${CSS.escape(id)}"]`)?.focus());
    };
    return combine(
      draggable({
        element: el,
        getInitialData: () => ({ type: 'board', id: board.id }),
        onDragStart: () => setDragging(true),
        onDrop: () => setDragging(false),
      }),
      dropTargetForElements({
        element: el,
        canDrop: ({ source }) => takesLane(source) || (isBoard(source) && source.data.id !== board.id),
        getData: ({ input, element, source }) =>
          isBoard(source) ? attachClosestEdge({ type: 'board', id: board.id }, { input, element, allowedEdges: ['left', 'right'] }) : { type: 'board', id: board.id },
        onDragEnter: ({ source }) => setOver(!isBoard(source)),
        onDrag: ({ self, source }) => {
          if (isBoard(source)) setEdge(extractClosestEdge(self.data));
        },
        onDragLeave: () => {
          setOver(false);
          setEdge(null);
        },
        onDrop: ({ self, source }) => {
          setOver(false);
          setEdge(null);
          if (isBoard(source)) {
            const id = source.data.id as string;
            moved(actions.moveBoardNear(id, board.id, extractClosestEdge(self.data) === 'left' ? 'left' : 'right'), id);
            return;
          }
          const lane = draggedLane(store, source);
          if (lane) actions.moveLaneToBoard(lane.id, board.id);
        },
      }),
      monitorForElements({
        canMonitor: ({ source }) => takesLane(source),
        onDragStart: () => setReady(true),
        onDrop: () => setReady(false),
      }),
    );
  }, [store, actions, announce, t, board.id]);

  // Alt + arrows move the tab, like a thought's card.
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (!e.altKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
    e.preventDefault();
    const result = actions.moveBoard(board.id, index + (e.key === 'ArrowLeft' ? -1 : 1));
    if (!result) return;
    announce(t('a11y.movedBoard', { position: result.index + 1, total: result.total }));
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-board-tab="${CSS.escape(board.id)}"]`)?.focus());
  };

  return (
    <button
      ref={ref}
      type="button"
      className={`w-board-tab${dragging ? ' w-board-tab--dragging' : ''}`}
      {...tabProps(look.color)}
      data-board-tab={board.id}
      data-drop={over ? 'over' : ready ? 'ready' : undefined}
      data-edge={edge ?? undefined}
      aria-current={current ? 'page' : undefined}
      aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight"
      title={t('boardLook.tabHint')}
      onClick={onSelect}
      onDoubleClick={onRename}
      onKeyDown={onKeyDown}
    >
      <BoardGlyph icon={look.icon} />
      <span className="w-board-tab__title">{board.title}</span>
    </button>
  );
}

/** A board in the list of them all, past the tabs: its icon or its colour, its title; the open one ticked. */
export function BoardItem({ board, current, onSelect }: { board: BoardDto; current: boolean; onSelect: () => void }) {
  const look = useBoardLook(board)!;
  return (
    <button type="button" className="w-menu__item w-tabs__item" aria-current={current ? 'page' : undefined} onClick={onSelect}>
      {look.icon ? <BoardGlyph icon={look.icon} /> : <span className="w-tabs__dot" aria-hidden="true" style={look.color ? ({ '--tab': look.color } as CSSProperties) : undefined} />}
      <span className="w-tabs__title">{board.title}</span>
      {current && <IconCheck />}
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
            {...(b.icon ? {} : corProps(b.color))}
            onClick={() => {
              close();
              actions.moveLaneToBoard(lane.id, b.id);
            }}
          >
            <BoardGlyph icon={b.icon} />
            <span className="w-menu__text">{b.title}</span>
          </button>
        ))
      )}
    </div>
  );
}
