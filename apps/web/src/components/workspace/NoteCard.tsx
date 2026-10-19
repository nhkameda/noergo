'use client';

import { draggable, dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/adapter/element-adapter';
import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine';
import { attachClosestEdge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge/attach-closest-edge';
import { extractClosestEdge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge/extract-closest-edge';
import type { Edge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/types';
import type { NoteDto } from '@noergo/core/dto';
import { useFormatter, useTranslations } from 'next-intl';
import { memo, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { agentProps, useAgentMark } from './agent-marks';
import { isEditable, useWorkspace } from './context';
import { IconCalendar, IconCheck, IconLink } from './icons';
import { corProps } from './cover';

/** Focus a card after React has drawn it in its new place. */
export function focusNote(id: string) {
  requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-note-id="${CSS.escape(id)}"]`)?.focus());
}

function focusSibling(from: HTMLElement, dir: 'up' | 'down' | 'left' | 'right') {
  const lane = from.closest<HTMLElement>('[data-lane-id]');
  if (!lane) return;
  const cards = [...lane.querySelectorAll<HTMLElement>('[data-note-id]')];
  const i = cards.indexOf(from);
  if (dir === 'up' || dir === 'down') {
    cards[dir === 'up' ? i - 1 : i + 1]?.focus();
    return;
  }
  const lanes = [...document.querySelectorAll<HTMLElement>('[data-lane-id]')];
  const next = lanes[lanes.indexOf(lane) + (dir === 'left' ? -1 : 1)];
  const target = next ? [...next.querySelectorAll<HTMLElement>('[data-note-id]')] : [];
  (target[Math.min(i, target.length - 1)] ?? next?.querySelector<HTMLElement>('[data-lane-add]'))?.focus();
}

const ARROWS: Record<string, 'up' | 'down' | 'left' | 'right'> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };

/**
 * A note on the board. Drag it with the mouse or finger; with the keyboard, arrows move
 * the focus and Alt + arrows move the note (announced to screen readers).
 */
export const NoteCard = memo(function NoteCard({ note }: { note: NoteDto }) {
  const t = useTranslations('app');
  const format = useFormatter();
  const { actions, openNote, announce, store } = useWorkspace();
  const ref = useRef<HTMLElement>(null);
  const [dragging, setDragging] = useState(false);
  const [edge, setEdge] = useState<Edge | null>(null);
  const agent = useAgentMark(note.id);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    return combine(
      draggable({
        element: el,
        getInitialData: () => ({ type: 'note', id: note.id, laneId: note.laneId }),
        onDragStart: () => setDragging(true),
        onDrop: () => setDragging(false),
      }),
      dropTargetForElements({
        element: el,
        canDrop: ({ source }) => source.data.type === 'note' && source.data.id !== note.id,
        getData: ({ input, element }) => attachClosestEdge({ type: 'note', id: note.id, laneId: note.laneId }, { input, element, allowedEdges: ['top', 'bottom'] }),
        onDrag: ({ self }) => setEdge(extractClosestEdge(self.data)),
        onDragLeave: () => setEdge(null),
        onDrop: () => setEdge(null),
      }),
    );
  }, [note.id, note.laneId]);

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.target !== e.currentTarget || isEditable(e.target)) return;
    const dir = ARROWS[e.key];
    if (dir && e.altKey) {
      e.preventDefault();
      const moved = actions.nudgeNote(note.id, dir);
      if (moved) {
        const lane = store.getState().data?.lanes.get(moved.laneId);
        announce(t('a11y.movedNote', { column: lane?.title ?? '', position: moved.index + 1, total: moved.total }));
        focusNote(note.id);
      }
    } else if (dir) {
      e.preventDefault();
      focusSibling(e.currentTarget, dir);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openNote(note.id);
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      focusSibling(e.currentTarget, 'down');
      actions.deleteNote(note.id);
    }
  };

  const done = note.doneAt !== null;
  const due = note.dueAt ? new Date(note.dueAt) : null;
  const overdue = !!due && !done && due.getTime() < new Date().setHours(0, 0, 0, 0);
  const title = note.title || note.excerpt || t('note.untitled');

  return (
    <li className="w-card-slot" data-edge={edge ?? undefined}>
      <article
        ref={ref}
        className={`nr-card w-card${done ? ' nr-card--feito' : ''}${dragging ? ' w-card--dragging' : ''}`}
        {...corProps(note.color)}
        {...agentProps(agent)}
        data-note-id={note.id}
        tabIndex={0}
        aria-label={title}
        aria-describedby="w-card-help"
        onClick={(e) => {
          if ((e.target as HTMLElement).closest('button')) return;
          openNote(note.id);
        }}
        onKeyDown={onKeyDown}
      >
        <div className="w-card__row">
          <button
            type="button"
            className={`w-check${done ? ' w-check--on' : ''}`}
            aria-pressed={done}
            aria-label={done ? t('note.markOpen') : t('note.markDone')}
            title={done ? t('note.markOpen') : t('note.markDone')}
            onClick={() => actions.toggleDone(note)}
          >
            {done && <IconCheck />}
          </button>
          <span className="nr-card__titulo w-card__title">{title}</span>
        </div>
        {note.title && note.excerpt && <p className="w-card__excerpt">{note.excerpt}</p>}
        {(note.tags.length > 0 || due || note.url) && (
          <div className="nr-card__meta w-card__meta">
            {due && (
              <span className={`w-due${overdue ? ' w-due--late' : ''}`}>
                <IconCalendar />
                {format.dateTime(due, { day: 'numeric', month: 'short' })}
              </span>
            )}
            {note.url && (
              <span className="w-card__link" title={note.url}>
                <IconLink />
              </span>
            )}
            {note.tags.slice(0, 4).map((tag) => (
              <span key={tag} className="nr-tag nr-tag--sem-ponto">
                #{tag}
              </span>
            ))}
            {note.tags.length > 4 && <span className="nr-tag nr-tag--sem-ponto">+{note.tags.length - 4}</span>}
          </div>
        )}
      </article>
    </li>
  );
});
