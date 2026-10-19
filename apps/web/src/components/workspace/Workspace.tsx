'use client';

import { LIMITS } from '@noergo/core/limits';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type RefObject } from 'react';
import { Actions } from './actions';
import { Board } from './Board';
import { CommandPalette } from './CommandPalette';
import { takePicture } from './cover-client';
import { CustomizePanel, type CustomizeTarget } from './Customize';
import { Gallery } from './Gallery';
import { isComposing, isEditable, useWorkspace, WorkspaceContext, type WorkspaceApi } from './context';
import { DueList } from './DueList';
import { useFocusHeartbeat } from './focus';
import { IconCards, IconCheck, IconClock, IconColumns, IconPlus, IconRedo, IconSearch, IconUndo, IconUser } from './icons';
import { LaneMap } from './LaneMap';
import { isIdeario, planIdeario } from './import-ideario';
import { boardsOf, captureLane, locate, type Data } from './model';
import { BoardTab } from './MoveToBoard';
import { NoteDrawer } from './NoteDrawer';
import { focusNote } from './NoteCard';
import { WorkspaceStore, type WorkspaceState } from './store';
import { InlineEdit, Menu, Swatches } from './ui';
import { LAYOUT } from './view-prefs';
import './workspace.css';

const MAX_IMPORT_BYTES = 200 * 1024 * 1024;
const boardKey = (userId: string) => `noergo:board:${userId}`;

/** `#map=<column id>`: a map survives a reload and Back closes it. */
function mapInUrl(): string | null {
  if (typeof window === 'undefined') return null;
  return /^#map=([0-9a-f-]{36})$/i.exec(window.location.hash)?.[1] ?? null;
}

/** /app#note=<id>: the link agents hand out (search, fetch). */
function noteInUrl(): string | null {
  return /^#note=([0-9a-f-]{36})$/i.exec(window.location.hash)?.[1] ?? null;
}

function readStoredBoard(userId: string): string | null {
  try {
    return localStorage.getItem(boardKey(userId));
  } catch {
    return null;
  }
}

/** The signed-in workspace: boards, the capture bar, the open note and search. */
export function Workspace({ userId, signInHref, homeHref, agentsHref, sourceUrl, signOut }: { userId: string; signInHref: string; homeHref: string; agentsHref: string; sourceUrl: string; signOut: () => Promise<void> }) {
  const t = useTranslations('app');
  const [store] = useState(() => new WorkspaceStore(userId, () => window.location.assign(signInHref)));
  const [actions] = useState(() => new Actions(store));
  const state: WorkspaceState = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  const { data } = state;

  const [chosenBoard, setChosenBoard] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [palette, setPalette] = useState(false);
  const [view, setView] = useState<'board' | 'due'>('board');
  const [hideDone, setHideDone] = useState(false);
  const [creatingBoard, setCreatingBoard] = useState(false);
  const [renamingBoard, setRenamingBoard] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const [mapLane, setMapLane] = useState<string | null>(mapInUrl);
  const [customizing, setCustomizing] = useState<CustomizeTarget | null>(null);
  const layout = LAYOUT.use();
  const capture = useRef<HTMLInputElement>(null);
  const returnFocus = useRef<string | null>(null);
  const revealing = useRef<string | null>(null);

  useEffect(() => {
    store.start();
    return () => store.stop();
  }, [store]);

  const boards = useMemo(() => (data ? boardsOf(data.boards) : []), [data]);
  const mapOf = mapLane ? data?.lanes.get(mapLane) : undefined;
  const map = mapOf && mapOf.deletedAt === null && data?.boards.get(mapOf.boardId)?.deletedAt === null && view === 'board' ? mapOf : null;
  const wanted = data ? (map?.boardId ?? chosenBoard ?? readStoredBoard(userId)) : null;
  const boardId = boards.find((b) => b.id === wanted)?.id ?? boards[0]?.id ?? null;
  const board = boardId ? data?.boards.get(boardId) : undefined;
  // "Here", for an agent: the thought whose map or note is open, else the board on screen.
  const openLane = map?.id ?? (openId ? (data?.notes.get(openId)?.laneId ?? null) : null);
  useFocusHeartbeat(!!data, view === 'due' ? 'dates' : map ? 'map' : layout === 'cards' ? 'cards' : 'board', boardId, openLane);

  const showBoard = useCallback(
    (id: string) => {
      setChosenBoard(id);
      setView('board');
      // Another board: the map of a column of this one stays behind.
      setMapLane((cur) => (cur && store.getState().data?.lanes.get(cur)?.boardId !== id ? null : cur));
      try {
        localStorage.setItem(boardKey(userId), id);
      } catch {
        // storage disabled: the choice lasts for this page only
      }
    },
    [userId, store],
  );

  const openMap = useCallback((laneId: string) => {
    setMapLane(laneId);
    setView('board');
    const hash = `#map=${laneId}`;
    // Next.js keeps its router state in history.state: extend it, never replace it.
    if (window.location.hash !== hash) window.history.pushState({ ...window.history.state, noergoMap: laneId }, '', hash);
  }, []);

  const closeMap = useCallback(() => {
    returnFocus.current = mapLane;
    if (window.history.state?.noergoMap) {
      window.history.back();
      return;
    }
    window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
    setMapLane(null);
  }, [mapLane]);

  useEffect(() => {
    const onPop = () => setMapLane(mapInUrl());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // Back on the board: focus returns to the column's map button (or its card).
  useEffect(() => {
    const id = returnFocus.current;
    if (map || !id) return;
    returnFocus.current = null;
    document.querySelector<HTMLElement>(`[data-lane-map="${CSS.escape(id)}"], [data-lane-tile="${CSS.escape(id)}"] .w-tile__open`)?.focus();
  }, [map]);

  const revealLane = useCallback((laneId: string) => {
    revealing.current = laneId;
    setView('board');
    LAYOUT.write('columns');
  }, []);

  // A card was opened: its column comes to the start of the board and lights up.
  useEffect(() => {
    const id = revealing.current;
    if (!id || layout !== 'columns' || view !== 'board') return;
    revealing.current = null;
    const el = document.querySelector<HTMLElement>(`[data-lane-id="${CSS.escape(id)}"]`);
    if (!el) return;
    el.scrollIntoView({ block: 'nearest', inline: 'start' });
    el.focus({ preventScroll: true });
    el.dataset.flash = '';
    const done = () => delete el.dataset.flash;
    el.addEventListener('animationend', done, { once: true });
    setTimeout(done, 2000);
  }, [layout, view]);

  const customize = useCallback(
    (laneId: string, anchor: DOMRect, file?: File) => {
      setCustomizing({ laneId, anchor });
      if (file) void takePicture(laneId, file, actions, store);
    },
    [actions, store],
  );

  const openNote = useCallback(
    (id: string) => {
      const where = store.getState().data && locate(store.getState().data!, id);
      if (!where) return;
      showBoard(where.board.id);
      setOpenId(id);
      requestAnimationFrame(() => document.querySelector(`[data-note-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
    },
    [store, showBoard],
  );

  // A link from an agent opens its note once, when the workspace first has data.
  useEffect(() => {
    const id = noteInUrl();
    if (!id) return;
    const off = store.subscribe(() => {
      const { data, connection } = store.getState();
      if (!data) return;
      const found = locate(data, id);
      // The cached snapshot comes first and may predate the note: wait for the server's.
      if (!found && connection !== 'live' && connection !== 'offline') return;
      off();
      window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
      if (found) openNote(id);
    });
    return () => void off();
  }, [store, openNote]);

  const announce = useCallback((text: string) => {
    setAnnouncement('');
    requestAnimationFrame(() => setAnnouncement(text));
  }, []);

  const api = useMemo<WorkspaceApi>(
    () => ({ store, actions, openNote, showBoard, openMap, announce, customize, revealLane }),
    [store, actions, openNote, showBoard, openMap, announce, customize, revealLane],
  );

  const closeNote = useCallback(() => {
    if (map) document.querySelector<HTMLElement>('.w-map__canvas')?.focus();
    else if (openId) focusNote(openId);
    setOpenId(null);
  }, [openId, map]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      if (mod && key === 'k') {
        e.preventDefault();
        setPalette(true);
        return;
      }
      if (isEditable(e.target) || e.defaultPrevented) return;
      if (mod && key === 'z') {
        e.preventDefault();
        if (e.shiftKey) store.redo();
        else store.undo();
      } else if (mod && key === 'y') {
        e.preventDefault();
        store.redo();
      } else if (!mod && !e.altKey && e.key === '/') {
        e.preventDefault();
        setPalette(true);
      } else if (!mod && !e.altKey && key === 'n') {
        e.preventDefault();
        capture.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [store]);

  const openNoteVisible = openId && data && locate(data, openId) ? openId : null;

  return (
    <WorkspaceContext.Provider value={api}>
      <div className={`w-app${openNoteVisible ? ' w-app--drawer' : ''}`}>
        <header className="w-top">
          <a className="w-logo" href={homeHref} aria-label="noergo">
            <img src="/favicon.svg" alt="" width={28} height={28} />
          </a>
          <nav className="w-boards" aria-label={t('boards')}>
            {boards.map((b) =>
              b.id === boardId && renamingBoard ? (
                <InlineEdit
                  key={b.id}
                  value={b.title}
                  label={t('boardName')}
                  maxLength={LIMITS.boardTitle}
                  onSave={(title) => {
                    actions.updateBoard(b.id, { title });
                    setRenamingBoard(false);
                  }}
                  onCancel={() => setRenamingBoard(false)}
                />
              ) : (
                <BoardTab key={b.id} board={b} current={b.id === boardId && view === 'board'} onSelect={() => showBoard(b.id)} onRename={() => b.id === boardId && setRenamingBoard(true)} />
              ),
            )}
            {creatingBoard ? (
              <InlineEdit
                value=""
                label={t('boardName')}
                placeholder={t('boardName')}
                maxLength={LIMITS.boardTitle}
                onSave={(title) => {
                  const id = actions.createBoard(title);
                  if (id) showBoard(id);
                  setCreatingBoard(false);
                }}
                onCancel={() => setCreatingBoard(false)}
              />
            ) : (
              data && (
                <button type="button" className="w-icon-btn" aria-label={t('newBoard')} title={t('newBoard')} onClick={() => setCreatingBoard(true)}>
                  <IconPlus />
                </button>
              )
            )}
            {board && (
              <Menu label={t('boardMenu', { title: board.title })}>
                {(close) => (
                  <>
                    <button type="button" className="w-menu__item" onClick={() => { close(); setRenamingBoard(true); }}>
                      {t('rename')}
                    </button>
                    <div className="w-menu__label">{t('color')}</div>
                    <Swatches value={board.color} label={t('color')} onChange={(color) => actions.updateBoard(board.id, { color })} />
                    <button type="button" className="w-menu__item w-menu__item--danger" onClick={() => { close(); actions.deleteBoard(board.id); }}>
                      {t('deleteBoard')}
                    </button>
                  </>
                )}
              </Menu>
            )}
          </nav>

          <div className="w-top__tools">
            <div className="nr-visoes" role="group" aria-label={t('viewLabel')}>
              <button type="button" aria-pressed={view === 'board' && layout === 'columns'} onClick={() => { setView('board'); LAYOUT.write('columns'); }}>
                <IconColumns />
                <span className="w-xs-sr">{t('viewColumns')}</span>
              </button>
              <button type="button" aria-pressed={view === 'board' && layout === 'cards'} onClick={() => { setView('board'); LAYOUT.write('cards'); }}>
                <IconCards />
                <span className="w-xs-sr">{t('viewCards')}</span>
              </button>
              <button type="button" aria-pressed={view === 'due'} onClick={() => setView('due')}>
                <IconClock />
                <span className="w-xs-sr">{t('due')}</span>
              </button>
            </div>
            <button type="button" className="w-icon-btn w-hide-sm" aria-pressed={hideDone} aria-label={hideDone ? t('showDone') : t('hideDone')} title={hideDone ? t('showDone') : t('hideDone')} onClick={() => setHideDone(!hideDone)}>
              <span className={`w-check w-check--sm${hideDone ? '' : ' w-check--on'}`} aria-hidden="true">
                {!hideDone && <IconCheck />}
              </span>
            </button>
            <button type="button" className="w-icon-btn w-hide-sm" aria-label={t('undo')} title={`${t('undo')} (⌘Z)`} disabled={!state.canUndo} onClick={() => store.undo()}>
              <IconUndo />
            </button>
            <button type="button" className="w-icon-btn w-hide-sm" aria-label={t('redo')} title={`${t('redo')} (⇧⌘Z)`} disabled={!state.canRedo} onClick={() => store.redo()}>
              <IconRedo />
            </button>
            <button type="button" className="nr-btn nr-btn--sm nr-btn--fantasma w-search-btn" onClick={() => setPalette(true)} aria-label={t('search')} aria-keyshortcuts="Meta+K Control+K">
              <IconSearch />
              <span className="w-hide-sm">{t('search')}</span>
              <kbd className="nr-kbd w-hide-sm">⌘K</kbd>
            </button>
            {state.agentWriting && <AgentPill name={state.agentWriting} />}
            <Status state={state} />
            <AccountMenu store={store} data={data} agentsHref={agentsHref} sourceUrl={sourceUrl} signOut={signOut} onImported={showBoard} />
          </div>
        </header>

        {data && <Capture data={data} boardId={boardId} inputRef={capture} />}

        <main className="w-main" id="main">
          {!data ? (
            <div className="nr-vazio" role="status">
              <span>{state.connection === 'offline' ? t('offline') : t('loading')}</span>
            </div>
          ) : view === 'due' ? (
            <DueList data={data} />
          ) : map ? (
            <LaneMap key={map.id} data={data} laneId={map.id} blocked={palette || !!openNoteVisible || !!customizing} onClose={closeMap} />
          ) : boardId && layout === 'cards' ? (
            <Gallery data={data} boardId={boardId} hideDone={hideDone} onOpen={revealLane} />
          ) : boardId ? (
            <Board data={data} boardId={boardId} hideDone={hideDone} />
          ) : (
            <div className="nr-vazio">
              <strong>{t('emptyBoards')}</strong>
              <span>{t('emptyBoardsHint')}</span>
              <button type="button" className="nr-btn nr-btn--primario" onClick={() => setCreatingBoard(true)}>
                <IconPlus />
                {t('newBoard')}
              </button>
            </div>
          )}
        </main>

        {openNoteVisible && data && <NoteDrawer data={data} noteId={openNoteVisible} onClose={closeNote} />}
        {palette && data && <CommandPalette data={data} onClose={() => setPalette(false)} />}
        {customizing && data?.lanes.get(customizing.laneId) && <CustomizePanel key={customizing.laneId} data={data} target={customizing} onClose={() => setCustomizing(null)} />}
        <Notices state={state} store={store} />

        <p id="w-card-help" className="w-sr">
          {t('a11y.keyboardHelp')}
        </p>
        <div className="w-sr" role="status" aria-live="polite">
          {announcement}
        </div>
      </div>
    </WorkspaceContext.Provider>
  );
}

/** "Grok is writing…": an agent is changing this workspace right now. Uva is the agents' colour. */
function AgentPill({ name }: { name: string }) {
  const t = useTranslations('app');
  return (
    <span className="w-agent-pill" role="status">
      <span className="w-agent-pill__avatar" aria-hidden="true">
        {name.trim().charAt(0).toUpperCase() || '✦'}
      </span>
      <span className="w-agent-pill__text">{t('agentWriting', { name })}</span>
    </span>
  );
}

function Status({ state }: { state: WorkspaceState }) {
  const t = useTranslations('app');
  const { connection, unsynced } = state;
  const label = connection === 'offline' ? t('offline') : connection === 'connecting' ? t('reconnecting') : connection === 'loading' ? t('loading') : unsynced > 0 ? t('saving', { count: unsynced }) : t('live');
  const tone = connection === 'offline' ? 'off' : connection === 'live' && unsynced === 0 ? 'on' : 'wait';
  return (
    <span className="w-status" data-tone={tone} role="status" title={label}>
      <span className="w-status__dot" aria-hidden="true" />
      <span className="w-status__text">{label}</span>
    </span>
  );
}

/** The capture bar: one line, Enter, and it is in the inbox column (where agents write too). */
function Capture({ data, boardId, inputRef }: { data: Data; boardId: string | null; inputRef: RefObject<HTMLInputElement | null> }) {
  const t = useTranslations('app');
  const { actions, store } = useWorkspace();
  const [text, setText] = useState('');
  const lane = captureLane(data, boardId);
  const submit = () => {
    if (!lane || !text.trim()) return;
    if (actions.createNote(lane.id, text, 'top')) {
      setText('');
      if (lane.boardId !== boardId) store.notify({ tone: 'info', key: 'captured', values: { column: lane.title } });
    }
  };
  return (
    <form
      className="w-capture"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <label className="nr-captura w-capture__bar">
        <span className="nr-captura__faisca" aria-hidden="true" />
        <span className="w-sr">{t('captureLabel')}</span>
        <input
          ref={inputRef}
          value={text}
          maxLength={LIMITS.noteBody}
          disabled={!lane}
          placeholder={lane ? t('capture', { column: lane.title }) : t('captureNoColumn')}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !isComposing(e)) {
              e.preventDefault();
              submit();
            } else if (e.key === 'Escape') {
              e.currentTarget.blur();
            }
          }}
        />
        <kbd className="nr-kbd w-hide-sm">N</kbd>
      </label>
    </form>
  );
}

function Notices({ state, store }: { state: WorkspaceState; store: WorkspaceStore }) {
  const t = useTranslations('app');
  return (
    <div className="w-notices" aria-live="polite">
      {state.notices.map((n) => (
        <div key={n.id} className="nr-aviso w-notice" data-tone={n.tone}>
          <span className="nr-aviso__ponto" aria-hidden="true" />
          <span>{t(`notices.${n.key}`, n.values)}</span>
          {n.undo && (
            <button
              type="button"
              onClick={() => {
                n.undo?.();
                store.dismiss(n.id);
              }}
            >
              {t('undo')}
            </button>
          )}
          <button type="button" aria-label={t('close')} onClick={() => store.dismiss(n.id)}>
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

function AccountMenu({ store, data, agentsHref, sourceUrl, signOut, onImported }: { store: WorkspaceStore; data: Data | null; agentsHref: string; sourceUrl: string; signOut: () => Promise<void>; onImported: (boardId: string) => void }) {
  const t = useTranslations('app');
  const tNav = useTranslations('nav');
  const file = useRef<HTMLInputElement>(null);

  const importFile = async (f: File) => {
    if (!data) return;
    if (f.size > MAX_IMPORT_BYTES) return store.notify({ tone: 'error', key: 'importFailed' });
    let json: unknown;
    try {
      json = JSON.parse(await f.text());
    } catch {
      return store.notify({ tone: 'error', key: 'importFailed' });
    }
    if (!isIdeario(json)) return store.notify({ tone: 'error', key: 'importFailed' });
    const last = boardsOf(data.boards).at(-1);
    const plan = planIdeario(
      json,
      { boardTitle: t('importBoardTitle'), untitledColumn: t('untitledColumn'), attachment: (name) => t('notices.attachmentPlaceholder', { name }) },
      last?.position ?? null,
    );
    store.dispatch(plan.ops);
    const first = plan.ops[0];
    if (first?.type === 'board.create') onImported(first.id);
    store.notify({ tone: 'info', key: 'imported', values: { columns: plan.columns, notes: plan.notes } });
    if (plan.skippedFiles) store.notify({ tone: 'info', key: 'importFiles', values: { count: plan.skippedFiles } });
  };

  return (
    <>
      <Menu label={t('account')} icon={<IconUser />}>
        {(close) => (
          <>
            <button
              type="button"
              className="w-menu__item"
              disabled={!data}
              onClick={() => {
                close();
                file.current?.click();
              }}
            >
              {t('import')}
            </button>
            <a className="w-menu__item" href={agentsHref}>
              {tNav('agents')}
            </a>
            <a className="w-menu__item" href={sourceUrl} target="_blank" rel="noopener noreferrer">
              {tNav('sourceCode')}
            </a>
            <form
              action={async () => {
                store.stop();
                await store.clearCache();
                await signOut();
              }}
            >
              <button type="submit" className="w-menu__item">
                {tNav('signOut')}
              </button>
            </form>
          </>
        )}
      </Menu>
      <input
        ref={file}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void importFile(f);
        }}
      />
    </>
  );
}
