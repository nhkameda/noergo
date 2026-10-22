'use client';

import type { LinkDto, NoteDto } from '@noergo/core/dto';
import { LIMITS } from '@noergo/core/limits';
import { useFormatter, useNow, useTranslations } from 'next-intl';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { isComposing, useWorkspace } from './context';
import { IconCheck, IconClose, IconFold, IconUnfold } from './icons';
import { Markdown } from './Markdown';
import { boardsOf, fold, lanesOf, locate, type Data } from './model';
import { makePatch, mapCaret, rebase } from './text-sync';
import { columnTree, noteKey, noteOf } from './tree';
import { Swatches } from './ui';

/** The editor's view of the body: what the text was rebased on, and whether a save is out. */
interface BodySync {
  el: HTMLTextAreaElement;
  version: number;
  body: string;
  inflight: boolean;
  composing: boolean;
  timer: ReturnType<typeof setTimeout> | null;
}

const SAVE_AFTER_MS = 700;

function replaceText(el: HTMLTextAreaElement, before: string, after: string) {
  const focused = document.activeElement === el;
  const [start, end] = [el.selectionStart, el.selectionEnd];
  el.value = after;
  if (focused) el.setSelectionRange(mapCaret(before, after, start), mapCaret(before, after, end));
}

/**
 * The body, edited as Markdown text. The textarea owns its text (no React state per
 * keystroke); saves are patches against the last body the server confirmed, and whatever
 * arrives from elsewhere (an agent appending, another tab) is merged under the caret.
 */
export function BodyEditor({ note, onWikilink }: { note: NoteDto; onWikilink: (target: string) => void }) {
  const t = useTranslations('app');
  const { store } = useWorkspace();
  const ta = useRef<HTMLTextAreaElement>(null);
  const sync = useRef<BodySync | null>(null);
  const loaded = note.body !== undefined;
  const [mode, setMode] = useState<'edit' | 'preview'>(note.body ? 'preview' : 'edit');
  // While unsaved text is shown in preview, the snapshot of it; null shows the note's body.
  const [previewText, setPreviewText] = useState<string | null>(null);

  const save = useCallback(() => {
    const run = async (): Promise<void> => {
      const s = sync.current;
      if (!s) return;
      if (s.timer) clearTimeout(s.timer);
      s.timer = null;
      if (s.inflight || s.composing) return;
      const sent = s.el.value;
      if (sent === s.body) return;
      s.inflight = true;
      const [outcome] = store.dispatch(
        {
          type: 'note.update',
          id: note.id,
          baseVersion: s.version,
          bodyPatch: makePatch(s.body, sent),
        },
        { local: { body: sent }, quiet: true },
      );
      const r = await outcome!;
      s.inflight = false;
      const local = s.el.value;
      if (r.status === 'applied') {
        const cur = store.note(note.id);
        if (cur?.body !== undefined) {
          const { text } = rebase(sent, local, cur.body);
          s.version = cur.version;
          s.body = cur.body;
          if (text !== local) replaceText(s.el, local, text);
        }
      } else if (r.status === 'conflict') {
        const current = r.error.details?.current as NoteDto | undefined;
        if (current?.body !== undefined) {
          const { text, clean } = rebase(s.body, local, current.body);
          s.version = current.version;
          s.body = current.body;
          if (text !== local) replaceText(s.el, local, text);
          store.notify({
            tone: clean ? 'info' : 'error',
            key: clean ? 'merged' : 'conflict',
          });
        }
      }
      setPreviewText(null);
      if (r.status !== 'rejected' && r.status !== 'dropped' && s.el.value !== s.body) s.timer = setTimeout(() => void run(), SAVE_AFTER_MS);
    };
    return run();
  }, [store, note.id]);

  const schedule = () => {
    const s = sync.current;
    if (!s) return;
    if (s.timer) clearTimeout(s.timer);
    s.timer = setTimeout(() => void save(), SAVE_AFTER_MS);
  };

  // Long bodies travel as excerpts: fetch the whole note when it opens.
  useEffect(() => {
    if (loaded) return;
    const ctrl = new AbortController();
    store.fetchNote(note.id, ctrl.signal).catch(() => {});
    return () => ctrl.abort();
  }, [loaded, note.id, store]);

  // First body known: the editor starts from it.
  useEffect(() => {
    const el = ta.current;
    if (!el || sync.current || note.body === undefined) return;
    el.value = note.body;
    sync.current = {
      el,
      version: note.version,
      body: note.body,
      inflight: false,
      composing: false,
      timer: null,
    };
  }, [note.body, note.version]);

  // A newer body from elsewhere: carry the unsaved edits over to it.
  useEffect(() => {
    const s = sync.current;
    if (!s || s.inflight || s.composing || note.body === undefined || note.version <= s.version) return;
    const local = s.el.value;
    const { text } = rebase(s.body, local, note.body);
    s.version = note.version;
    s.body = note.body;
    if (text !== local) replaceText(s.el, local, text);
  }, [note.version, note.body]);

  // Closing the note sends what is left.
  useEffect(
    () => () => {
      void save();
    },
    [save],
  );

  const toPreview = () => {
    const s = sync.current;
    setPreviewText(s && s.el.value !== s.body ? s.el.value : null);
    void save();
    setMode('preview');
  };
  const toEdit = () => {
    setMode('edit');
    requestAnimationFrame(() => ta.current?.focus());
  };

  return (
    <div className="w-body">
      <div className="nr-visoes w-body__tabs" role="group" aria-label={t('note.body')}>
        <button type="button" aria-pressed={mode === 'edit'} onClick={toEdit}>
          {t('note.edit')}
        </button>
        <button type="button" aria-pressed={mode === 'preview'} onClick={toPreview} disabled={!loaded}>
          {t('note.preview')}
        </button>
      </div>
      <textarea
        ref={ta}
        className="w-body__input"
        hidden={mode !== 'edit'}
        aria-label={t('note.body')}
        placeholder={loaded ? t('note.bodyPlaceholder') : t('note.loadingBody')}
        disabled={!loaded}
        maxLength={LIMITS.noteBody}
        spellCheck
        onInput={schedule}
        onBlur={() => void save()}
        onCompositionStart={() => sync.current && (sync.current.composing = true)}
        onCompositionEnd={() => {
          if (sync.current) sync.current.composing = false;
          schedule();
        }}
      />
      {mode === 'preview' && (
        // A click on the text (not on a link) goes back to editing.
        <div
          className="w-body__preview"
          onClick={(e) => {
            if (!(e.target as HTMLElement).closest('a, button')) toEdit();
          }}
        >
          {loaded ? (
            (previewText ?? note.body) ? (
              <Markdown text={previewText ?? note.body ?? ''} onWikilink={onWikilink} />
            ) : (
              <p className="w-muted">{t('note.bodyPlaceholder')}</p>
            )
          ) : (
            <p className="w-muted">{t('note.loadingBody')}</p>
          )}
        </div>
      )}
    </div>
  );
}

function TagEditor({ note }: { note: NoteDto }) {
  const t = useTranslations('app');
  const { actions } = useWorkspace();
  const [draft, setDraft] = useState('');
  const add = () => {
    for (const raw of draft.split(/[\s,]+/)) {
      const tag = raw.replace(/^#/, '').toLowerCase();
      if (tag && !note.tags.includes(tag)) actions.addTag(note.id, tag.slice(0, LIMITS.tagLength));
    }
    setDraft('');
  };
  return (
    <div className="w-tags">
      {note.tags.map((tag) => (
        <span key={tag} className="nr-tag nr-tag--sem-ponto w-tag">
          #{tag}
          <button type="button" className="w-tag__x" aria-label={t('note.removeTag', { tag })} onClick={() => actions.removeTag(note.id, tag)}>
            <IconClose />
          </button>
        </span>
      ))}
      {note.tags.length < LIMITS.tags && (
        <input
          className="w-tags__input"
          aria-label={t('note.addTag')}
          placeholder={t('note.addTag')}
          value={draft}
          maxLength={LIMITS.tagLength * 4}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={add}
          onKeyDown={(e) => {
            if ((e.key === 'Enter' || e.key === ',') && !isComposing(e)) {
              e.preventDefault();
              add();
            } else if (e.key === 'Backspace' && !draft && note.tags.length) {
              actions.removeTag(note.id, note.tags.at(-1)!);
            }
          }}
        />
      )}
    </div>
  );
}

/** A local date (YYYY-MM-DD) and the instant stored for it: noon, so no time zone moves the day. */
const toDateInput = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const fromDateInput = (v: string) => (v ? new Date(`${v}T12:00:00`).toISOString() : null);

function isSafeUrl(v: string): boolean {
  try {
    return ['http:', 'https:', 'mailto:'].includes(new URL(v).protocol);
  } catch {
    return false;
  }
}

type LinkRow = {
  link: LinkDto;
  other: { kind: string; id: string };
  title: string;
};

/** Links of a note both ways, from what the browser holds (the live stream keeps them current). */
function linksOf(data: Data, noteId: string): { outgoing: LinkRow[]; incoming: LinkRow[] } {
  const outgoing: LinkRow[] = [];
  const incoming: LinkRow[] = [];
  for (const link of data.links.values()) {
    if (link.deletedAt !== null) continue;
    const out = link.from.kind === 'note' && link.from.id === noteId;
    const inc = link.to.kind === 'note' && link.to.id === noteId;
    if (!out && !inc) continue;
    const other = out ? link.to : link.from;
    const title = other.kind === 'note' ? (locate(data, other.id)?.note.title ?? null) : other.kind === 'lane' ? (data.lanes.get(other.id)?.title ?? null) : (data.boards.get(other.id)?.title ?? null);
    if (title === null) continue;
    (out ? outgoing : incoming).push({ link, other, title });
  }
  return { outgoing, incoming };
}

/** Opens a note the way a wikilink names it: [[its title]], or note:<id>. */
export function useOpenByTitle() {
  const { openNote, store } = useWorkspace();
  return useCallback(
    (target: string) => {
      const byId = /^note:([0-9a-f-]{36})$/i.exec(target);
      const all = store.getState().data;
      if (!all) return;
      if (byId) return openNote(byId[1]!.toLowerCase());
      const want = fold(target.trim());
      for (const n of all.notes.values()) if (fold(n.title) === want && locate(all, n.id)) return openNote(n.id);
      store.notify({
        tone: 'info',
        key: 'noSuchNote',
        values: { title: target },
      });
    },
    [openNote, store],
  );
}

/** Done, and the title as a field: Enter or leaving saves, Esc gives up. */
export function NoteTitle({ note, onEscape }: { note: NoteDto; onEscape: () => void }) {
  const t = useTranslations('app');
  const { actions } = useWorkspace();
  const [titleDraft, setTitleDraft] = useState<string | null>(null);
  const done = note.doneAt !== null;
  const commitTitle = () => {
    if (titleDraft !== null && titleDraft.trim() !== note.title) actions.updateNote(note.id, { title: titleDraft.trim() });
    setTitleDraft(null);
  };
  return (
    <div className="w-drawer__title-row">
      <button
        type="button"
        className={`w-check w-check--lg${done ? ' w-check--on' : ''}`}
        aria-pressed={done}
        aria-label={done ? t('note.markOpen') : t('note.markDone')}
        title={done ? t('note.markOpen') : t('note.markDone')}
        onClick={() => actions.toggleDone(note)}
      >
        {done && <IconCheck />}
      </button>
      <textarea
        className="w-drawer__title"
        aria-label={t('note.title')}
        placeholder={t('note.untitled')}
        rows={1}
        maxLength={LIMITS.noteTitle}
        value={titleDraft ?? note.title}
        onFocus={() => setTitleDraft(note.title)}
        onChange={(e) => setTitleDraft(e.target.value.replace(/\n/g, ' '))}
        onBlur={commitTitle}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !isComposing(e)) {
            e.preventDefault();
            e.currentTarget.blur();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            setTitleDraft(null);
            requestAnimationFrame(onEscape);
          }
        }}
      />
    </div>
  );
}

export function TagsField({ note }: { note: NoteDto }) {
  const t = useTranslations('app');
  return (
    <div className="w-field">
      <dt>{t('note.tags')}</dt>
      <dd>
        <TagEditor note={note} />
      </dd>
    </div>
  );
}

export function DueField({ note }: { note: NoteDto }) {
  const t = useTranslations('app');
  const { actions } = useWorkspace();
  const id = useId();
  return (
    <div className="w-field">
      <dt>
        <label htmlFor={id}>{t('note.dueDate')}</label>
      </dt>
      <dd className="w-field__row">
        <input
          id={id}
          type="date"
          className="w-input"
          value={toDateInput(note.dueAt)}
          onChange={(e) =>
            actions.updateNote(note.id, {
              dueAt: fromDateInput(e.target.value),
            })
          }
        />
        {note.dueAt && (
          <button type="button" className="nr-btn nr-btn--sm nr-btn--fantasma" onClick={() => actions.updateNote(note.id, { dueAt: null })}>
            {t('note.clearDue')}
          </button>
        )}
      </dd>
    </div>
  );
}

export function LinkField({ note }: { note: NoteDto }) {
  const t = useTranslations('app');
  const { actions } = useWorkspace();
  const id = useId();
  const [urlDraft, setUrlDraft] = useState<string | null>(null);
  const commitUrl = () => {
    if (urlDraft === null) return;
    const v = urlDraft.trim();
    if (!v) {
      if (note.url) actions.updateNote(note.id, { url: null });
    } else if (isSafeUrl(v) && v !== note.url) {
      actions.updateNote(note.id, { url: v });
    }
    setUrlDraft(null);
  };
  const urlInvalid = urlDraft !== null && urlDraft.trim() !== '' && !isSafeUrl(urlDraft.trim());
  return (
    <div className="w-field">
      <dt>
        <label htmlFor={id}>{t('note.link')}</label>
      </dt>
      <dd className="w-field__row">
        <input
          id={id}
          type="url"
          inputMode="url"
          className="w-input"
          placeholder={t('note.linkPlaceholder')}
          aria-invalid={urlInvalid}
          maxLength={LIMITS.url}
          value={urlDraft ?? note.url ?? ''}
          onFocus={() => setUrlDraft(note.url ?? '')}
          onChange={(e) => setUrlDraft(e.target.value)}
          onBlur={commitUrl}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              e.currentTarget.blur();
            }
          }}
        />
        {note.url && urlDraft === null && (
          <a className="nr-btn nr-btn--sm nr-btn--fantasma" href={note.url} target="_blank" rel="noopener noreferrer nofollow ugc">
            {t('note.openLink')}
          </a>
        )}
      </dd>
      {urlInvalid && <small className="w-field__error">{t('note.linkInvalid')}</small>}
    </div>
  );
}

/**
 * The open note, beside the board (over it on a phone). Every field saves on its own;
 * nothing here has a Save button, because agents may be editing the same note.
 */
export function NoteDrawer({ data, noteId, onClose }: { data: Data; noteId: string; onClose: () => void }) {
  const t = useTranslations('app');
  const format = useFormatter();
  // "Updated 3 minutes ago" moves on while the note stays open.
  const now = useNow({ updateInterval: 60_000 });
  const { actions } = useWorkspace();
  const where = locate(data, noteId);
  const panel = useRef<HTMLElement>(null);
  const { boards, lanes } = data;
  const columns = useMemo(() => boardsOf(boards).map((b) => ({ board: b, lanes: lanesOf(lanes, b.id) })), [boards, lanes]);
  const related = useMemo(() => linksOf(data, noteId), [data, noteId]);
  const openByTitle = useOpenByTitle();
  const colId = useId();

  useEffect(() => {
    panel.current?.focus();
  }, [noteId]);

  if (!where) return null;
  const { note, lane, board } = where;

  return (
    <aside
      ref={panel}
      className="w-drawer nr-surgir"
      role="dialog"
      aria-modal="false"
      aria-label={note.title || t('note.untitled')}
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !e.defaultPrevented) {
          e.preventDefault();
          onClose();
        }
      }}
    >
      <header className="w-drawer__head">
        <span className="w-drawer__where">
          {board.title} / {lane.title}
        </span>
        <button type="button" className="w-icon-btn" aria-label={t('close')} title={t('close')} onClick={onClose}>
          <IconClose />
        </button>
      </header>

      <NoteTitle note={note} onEscape={() => panel.current?.focus()} />

      <BodyEditor key={note.id} note={note} onWikilink={openByTitle} />

      <dl className="w-fields">
        <TagsField note={note} />
        <DueField note={note} />
        <div className="w-field">
          <dt>
            <label htmlFor={colId}>{t('note.column')}</label>
          </dt>
          <dd>
            <select id={colId} className="w-input" value={lane.id} onChange={(e) => actions.moveNote(note.id, { laneId: e.target.value, index: 0 })}>
              {columns.map(({ board: b, lanes: ls }) => (
                <optgroup key={b.id} label={b.title}>
                  {ls.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.title}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </dd>
        </div>
        <LinkField note={note} />
        <div className="w-field">
          <dt>{t('color')}</dt>
          <dd>
            <Swatches value={note.color} label={t('color')} onChange={(color) => actions.updateNote(note.id, { color })} />
          </dd>
        </div>
      </dl>

      <Below data={data} note={note} />

      <section className="w-related" aria-label={t('note.links')}>
        <h3 className="w-related__title">{t('note.links')}</h3>
        {related.outgoing.length + related.incoming.length === 0 ? (
          <p className="w-muted">{t('note.noLinks')}</p>
        ) : (
          <>
            {related.outgoing.length > 0 && (
              <ul className="w-related__list">
                {related.outgoing.map((r) => (
                  <li key={r.link.id}>
                    <RelatedLink row={r} />
                  </li>
                ))}
              </ul>
            )}
            {related.incoming.length > 0 && (
              <>
                <h4 className="w-related__sub">{t('note.backlinks')}</h4>
                <ul className="w-related__list">
                  {related.incoming.map((r) => (
                    <li key={r.link.id}>
                      <RelatedLink row={r} />
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </section>

      <footer className="w-drawer__foot">
        <span className="w-muted">
          {t('note.updated', {
            when: format.relativeTime(new Date(note.updatedAt), now),
          })}
        </span>
        <button
          type="button"
          className="nr-btn nr-btn--sm nr-btn--fantasma w-danger-text"
          onClick={() => {
            onClose();
            actions.deleteNote(note.id);
          }}
        >
          {t('note.deleteNote')}
        </button>
      </footer>
    </aside>
  );
}

/**
 * What hangs from the note, as on the map's panel: fold it or show it, and a new idea
 * under it, typed here (Enter adds it and keeps the field for the next).
 */
function Below({ data, note }: { data: Data; note: NoteDto }) {
  const t = useTranslations('app');
  const { actions } = useWorkspace();
  const [draft, setDraft] = useState('');
  const id = useId();
  const tree = useMemo(() => columnTree(data, note.laneId), [data, note.laneId]);
  const key = noteKey(note.id);
  const folded = tree.folded.get(key)?.length ?? 0;
  const why = folded ? null : tree.blocker(key);
  const by = why && why !== 'leaf' ? data.notes.get(noteOf(why)!) : undefined;
  const blocker = why && why !== 'leaf' ? by?.title || by?.excerpt || t('note.untitled') : null;
  const add = () => {
    if (actions.createChild(note.id, draft)) setDraft('');
  };
  return (
    <section className="w-below" aria-labelledby={id}>
      <h3 id={id} className="w-related__title">
        {t('note.below')}
      </h3>
      {why !== 'leaf' && (
        <div className="w-below__fold">
          <button type="button" className="nr-btn nr-btn--sm nr-btn--fantasma" disabled={blocker !== null} onClick={() => actions.setCollapsed([note.id], !(folded > 0 || note.collapsed))}>
            {folded ? <IconUnfold /> : <IconFold />}
            {folded ? t('map.unfold') : t('map.fold')}
            <span className="w-map__fold-count">{folded || tree.below(key).length}</span>
          </button>
          {blocker !== null && <p className="w-muted w-below__hint">{t('notices.foldBlocked', { title: blocker })}</p>}
        </div>
      )}
      <input
        className="w-input"
        aria-label={t('note.addBelow')}
        placeholder={t('note.addBelowHint')}
        value={draft}
        maxLength={LIMITS.noteBody}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !isComposing(e)) {
            e.preventDefault();
            add();
          }
        }}
      />
    </section>
  );
}

function RelatedLink({ row }: { row: LinkRow }) {
  const { openNote, showBoard, store } = useWorkspace();
  const t = useTranslations('app');
  const go = () => {
    if (row.other.kind === 'note') openNote(row.other.id);
    else if (row.other.kind === 'board') showBoard(row.other.id);
    else {
      const lane = store.getState().data?.lanes.get(row.other.id);
      if (lane) showBoard(lane.boardId);
    }
  };
  return (
    <button type="button" className="w-related__item" onClick={go}>
      <span>{row.title || t('note.untitled')}</span>
      {row.link.label && <span className="w-muted"> — {row.link.label}</span>}
    </button>
  );
}
