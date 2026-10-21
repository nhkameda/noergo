'use client';

import { draggable, dropTargetForElements, monitorForElements } from '@atlaskit/pragmatic-drag-and-drop/adapter/element-adapter';
import { autoScrollForElements } from '@atlaskit/pragmatic-drag-and-drop-auto-scroll/element';
import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine';
import { attachClosestEdge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge/attach-closest-edge';
import { extractClosestEdge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge/extract-closest-edge';
import type { Edge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/types';
import type { LaneDto, NoteDto } from '@noergo/core/dto';
import { LIMITS } from '@noergo/core/limits';
import { useTranslations } from 'next-intl';
import { memo, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useAgentMarks } from './agent-marks';
import { isComposing, useWorkspace } from './context';
import { CoverArt } from './CoverArt';
import { laneStyle } from './cover';
import { useFileDrag, useImageDrop, useLaneLook } from './cover-client';
import { IconBrush, IconGlobe, IconImage, IconMap, IconPlus } from './icons';
import { NoteCard } from './NoteCard';
import { MoveToBoard } from './MoveToBoard';
import { siteHost } from './site';
import { columnRows, noteKey, type LaneTree } from './tree';
import { InlineEdit, Menu } from './ui';

export const Lane = memo(function Lane({ lane, notes, tree, hideDone, index, total }: { lane: LaneDto; notes: NoteDto[]; tree: LaneTree; hideDone: boolean; index: number; total: number }) {
  const t = useTranslations('app');
  const { actions, announce, openMap, customize, store } = useWorkspace();
  const look = useLaneLook(lane);
  const files = useFileDrag();
  const section = useRef<HTMLElement>(null);
  const top = useRef<HTMLDivElement>(null);
  const handle = useRef<HTMLHeadingElement>(null);
  const list = useRef<HTMLOListElement>(null);
  const [renaming, setRenaming] = useState(false);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const [laneEdge, setLaneEdge] = useState<Edge | null>(null);
  const [noteOver, setNoteOver] = useState(false);
  const [dragging, setDragging] = useState(false);
  // The idea being dragged out of this column: what hangs from it fades with it.
  const [carrying, setCarrying] = useState<string | null>(null);
  const agentMarks = useAgentMarks();

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
      monitorForElements({
        canMonitor: ({ source }) => source.data.type === 'note' && source.data.laneId === lane.id,
        onDragStart: ({ source }) => setCarrying(source.data.id as string),
        onDrop: () => setCarrying(null),
      }),
    );
  }, [lane.id, renaming]);

  const count = hideDone ? notes.filter((n) => n.doneAt === null).length : notes.length;
  const rows = useMemo(() => columnRows(notes, tree, hideDone), [notes, tree, hideDone]);
  const carried = new Set<string>();
  const from = rows.findIndex((r) => r.note.id === carrying);
  for (let i = from + 1; from >= 0 && i < rows.length && rows[i]!.depth > rows[from]!.depth; i++) carried.add(rows[i]!.note.id);

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
  const personalize = (file?: File) => customize(lane.id, top.current!.getBoundingClientRect(), file);
  const drop = useImageDrop(
    (file) => personalize(file),
    () => store.notify({ tone: 'error', key: 'coverNotImage' }),
  );
  const move = (to: number) => {
    const moved = actions.moveLane(lane.id, to);
    if (moved) announce(t('a11y.movedColumn', { position: moved.index + 1, total: moved.total }));
  };

  return (
    <section
      ref={section}
      className={`nr-coluna w-lane${dragging ? ' w-lane--dragging' : ''}${noteOver ? ' w-lane--over' : ''}`}
      {...laneStyle(look.color)}
      data-lane-id={lane.id}
      data-edge={laneEdge ?? undefined}
      aria-labelledby={`lane-${lane.id}`}
      tabIndex={-1}
    >
      <div ref={top} className="w-lane__top" {...drop.props} data-over={drop.over || undefined}>
        {look.cover && (
          <button type="button" className="w-lane__cover" onClick={() => personalize()} aria-label={t('customize.open', { title: lane.title })} title={t('customize.openShort')}>
            <CoverArt look={look.cover} />
            {look.uploading && <span className="w-lane__busy" aria-hidden="true" />}
          </button>
        )}
        {/* Three rows: the title, the description, the tools. The title keeps the whole width. */}
        <header className="w-lane__head">
          {renaming ? (
            <InlineEdit value={lane.title} label={t('columnName')} maxLength={LIMITS.laneTitle} onSave={(title) => { actions.updateLane(lane.id, { title }); setRenaming(false); }} onCancel={() => setRenaming(false)} />
          ) : (
            <h2 ref={handle} id={`lane-${lane.id}`} className="w-lane__title" title={t('a11y.dragHandle')} onDoubleClick={() => setRenaming(true)}>
              {lane.title}
            </h2>
          )}
          {lane.description && (
            <p className="w-lane__desc" onDoubleClick={() => personalize()}>
              {lane.description}
            </p>
          )}
          <div className="w-lane__tools">
            <button type="button" className="w-lane__paint" data-lane-customize={lane.id} aria-label={t('customize.open', { title: lane.title })} title={t('customize.openShort')} onClick={() => personalize()}>
              <IconBrush />
            </button>
            <span className="nr-coluna__conta w-lane__count" aria-label={t('notesCount', { count })}>
              {count}
            </span>
            {lane.url && (
              <a className="w-icon-btn" data-lane-site={lane.id} href={lane.url} target="_blank" rel="noopener noreferrer nofollow ugc" aria-label={t('site.open', { title: lane.title, host: siteHost(lane.url) })} title={siteHost(lane.url)}>
                <IconGlobe />
              </a>
            )}
            <button type="button" className="w-icon-btn" data-lane-map={lane.id} aria-label={t('map.openColumn', { title: lane.title })} title={t('map.open')} onClick={() => openMap(lane.id)}>
              <IconMap />
            </button>
            <button type="button" className="w-icon-btn" data-lane-add aria-label={t('newNote')} title={t('newNote')} onClick={() => setAdding(true)}>
              <IconPlus />
            </button>
            <Menu label={t('columnMenu', { title: lane.title })}>
              {(close) => (
                <>
                  <button type="button" className="w-menu__item" onClick={() => { close(); setRenaming(true); }}>
                    {t('rename')}
                  </button>
                  <button type="button" className="w-menu__item" onClick={() => { close(); personalize(); }}>
                    {t('customize.menu')}
                  </button>
                  <button type="button" className="w-menu__item" disabled={index === 0} onClick={() => move(index - 1)}>
                    {t('moveLeft')}
                  </button>
                  <button type="button" className="w-menu__item" disabled={index === total - 1} onClick={() => move(index + 1)}>
                    {t('moveRight')}
                  </button>
                  {tree.hidden.size > 0 && (
                    <button type="button" className="w-menu__item" onClick={() => { close(); actions.setCollapsed(notes.filter((n) => n.collapsed).map((n) => n.id), false); }}>
                      {t('map.unfoldAll')}
                    </button>
                  )}
                  {notes.some((n) => !n.collapsed && tree.blocker(noteKey(n.id)) === null) && (
                    <button type="button" className="w-menu__item" onClick={() => { close(); actions.setCollapsed(notes.filter((n) => !n.collapsed && tree.blocker(noteKey(n.id)) === null).map((n) => n.id), true); }}>
                      {t('map.foldAll')}
                    </button>
                  )}
                  <MoveToBoard lane={lane} close={close} />
                  <button type="button" className="w-menu__item w-menu__item--danger" onClick={() => { close(); actions.deleteLane(lane.id); }}>
                    {t('deleteColumn')}
                  </button>
                </>
              )}
            </Menu>
          </div>
        </header>
        {files && (
          <div className="w-drop-hint" aria-hidden="true">
            <IconImage />
            {t('customize.dropShort')}
          </div>
        )}
      </div>

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
        {rows.map((r) => (
          <NoteCard
            key={r.note.id}
            note={r.note}
            depth={r.depth}
            open={r.open}
            folded={r.folded}
            branch={r.branch}
            blocker={r.blocker}
            carried={carried.has(r.note.id)}
            agentInside={r.folded > 0 && !!tree.folded.get(noteKey(r.note.id))?.some((k) => agentMarks.get(k.slice(5))?.fresh)}
          />
        ))}
        {rows.length === 0 && !adding && <li className="w-lane__empty">{t('emptyColumn')}</li>}
      </ol>
    </section>
  );
});
