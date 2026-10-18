'use client';

import { draggable, dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/adapter/element-adapter';
import { autoScrollForElements } from '@atlaskit/pragmatic-drag-and-drop-auto-scroll/element';
import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine';
import { attachClosestEdge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge/attach-closest-edge';
import { extractClosestEdge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge/extract-closest-edge';
import type { Edge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/types';
import type { LaneDto, NoteDto } from '@noergo/core/dto';
import { LIMITS } from '@noergo/core/limits';
import { useTranslations } from 'next-intl';
import { memo, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { isComposing, useWorkspace } from './context';
import { IconPlus } from './icons';
import { colorName } from './model';
import { NoteCard } from './NoteCard';
import { InlineEdit, Menu, Swatches } from './ui';

export const Lane = memo(function Lane({ lane, notes, hideDone, index, total }: { lane: LaneDto; notes: NoteDto[]; hideDone: boolean; index: number; total: number }) {
  const t = useTranslations('app');
  const { actions, announce } = useWorkspace();
  const section = useRef<HTMLElement>(null);
  const handle = useRef<HTMLHeadingElement>(null);
  const list = useRef<HTMLOListElement>(null);
  const [renaming, setRenaming] = useState(false);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const [laneEdge, setLaneEdge] = useState<Edge | null>(null);
  const [noteOver, setNoteOver] = useState(false);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const el = section.current;
    const grip = handle.current;
    const ol = list.current;
    if (!el || !grip || !ol) return;
    return combine(
      draggable({
        element: el,
        dragHandle: grip,
        getInitialData: () => ({ type: 'lane', id: lane.id }),
        onDragStart: () => setDragging(true),
        onDrop: () => setDragging(false),
      }),
      dropTargetForElements({
        element: el,
        canDrop: ({ source }) => source.data.type === 'lane' || source.data.type === 'note',
        getData: ({ input, element, source }) =>
          source.data.type === 'lane' ? attachClosestEdge({ type: 'lane', id: lane.id, laneId: lane.id }, { input, element, allowedEdges: ['left', 'right'] }) : { type: 'lane', id: lane.id, laneId: lane.id },
        onDrag: ({ self, source }) => setLaneEdge(source.data.type === 'lane' && source.data.id !== lane.id ? extractClosestEdge(self.data) : null),
        onDragLeave: () => setLaneEdge(null),
        onDrop: () => setLaneEdge(null),
      }),
      dropTargetForElements({
        element: ol,
        canDrop: ({ source }) => source.data.type === 'note',
        getData: () => ({ type: 'lane-list', laneId: lane.id }),
        onDragEnter: () => setNoteOver(true),
        onDragLeave: () => setNoteOver(false),
        onDrop: () => setNoteOver(false),
      }),
      autoScrollForElements({ element: ol }),
    );
  }, [lane.id, renaming]);

  const shown = hideDone ? notes.filter((n) => n.doneAt === null) : notes;

  const submit = () => {
    if (actions.createNote(lane.id, draft)) setDraft('');
  };
  const onComposerKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !isComposing(e)) {
      e.preventDefault();
      submit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setAdding(false);
      setDraft('');
    }
  };
  const move = (to: number) => {
    const moved = actions.moveLane(lane.id, to);
    if (moved) announce(t('a11y.movedColumn', { position: moved.index + 1, total: moved.total }));
  };

  return (
    <section
      ref={section}
      className={`nr-coluna w-lane${dragging ? ' w-lane--dragging' : ''}${noteOver ? ' w-lane--over' : ''}`}
      data-cor={colorName(lane.color)}
      data-lane-id={lane.id}
      data-edge={laneEdge ?? undefined}
      aria-labelledby={`lane-${lane.id}`}
    >
      <header className="nr-coluna__cabeca w-lane__head">
        {renaming ? (
          <InlineEdit value={lane.title} label={t('columnName')} maxLength={LIMITS.laneTitle} onSave={(title) => { actions.updateLane(lane.id, { title }); setRenaming(false); }} onCancel={() => setRenaming(false)} />
        ) : (
          <h2 ref={handle} id={`lane-${lane.id}`} className="w-lane__title" title={t('a11y.dragHandle')} onDoubleClick={() => setRenaming(true)}>
            {lane.title}
          </h2>
        )}
        <span className="nr-coluna__conta" aria-label={t('notesCount', { count: shown.length })}>
          {shown.length}
        </span>
        <button type="button" className="w-icon-btn" data-lane-add aria-label={t('newNote')} title={t('newNote')} onClick={() => setAdding(true)}>
          <IconPlus />
        </button>
        <Menu label={t('columnMenu', { title: lane.title })}>
          {(close) => (
            <>
              <button type="button" className="w-menu__item" onClick={() => { close(); setRenaming(true); }}>
                {t('rename')}
              </button>
              <div className="w-menu__label">{t('color')}</div>
              <Swatches value={lane.color} label={t('color')} onChange={(color) => actions.updateLane(lane.id, { color })} />
              <button type="button" className="w-menu__item" disabled={index === 0} onClick={() => move(index - 1)}>
                {t('moveLeft')}
              </button>
              <button type="button" className="w-menu__item" disabled={index === total - 1} onClick={() => move(index + 1)}>
                {t('moveRight')}
              </button>
              <button type="button" className="w-menu__item w-menu__item--danger" onClick={() => { close(); actions.deleteLane(lane.id); }}>
                {t('deleteColumn')}
              </button>
            </>
          )}
        </Menu>
      </header>

      {adding && (
        <div className="w-composer">
          <textarea
            className="w-composer__input"
            aria-label={t('newNote')}
            placeholder={t('noteText')}
            value={draft}
            autoFocus
            rows={2}
            maxLength={LIMITS.noteBody}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onComposerKey}
            onBlur={() => {
              if (!draft.trim()) setAdding(false);
            }}
          />
          <div className="w-composer__actions">
            <button type="button" className="nr-btn nr-btn--sm nr-btn--primario" onMouseDown={(e) => e.preventDefault()} onClick={submit}>
              {t('add')}
            </button>
            <button type="button" className="nr-btn nr-btn--sm nr-btn--fantasma" onClick={() => { setAdding(false); setDraft(''); }}>
              {t('cancel')}
            </button>
          </div>
        </div>
      )}

      <ol ref={list} className="w-cards">
        {shown.map((n) => (
          <NoteCard key={n.id} note={n} />
        ))}
        {shown.length === 0 && !adding && <li className="w-lane__empty">{t('emptyColumn')}</li>}
      </ol>
    </section>
  );
});
