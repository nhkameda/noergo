'use client';

import type { SearchHit } from '@noergo/core/read';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState } from 'react';
import { BoardGlyph } from './BoardLook';
import { isComposing, useWorkspace } from './context';
import { IconBoard, IconNote, IconSearch } from './icons';
import { boardsOf, fold, localSearch, locate, type Data } from './model';

type Item = { kind: 'board'; id: string; title: string; where: string } | { kind: 'note'; id: string; title: string; where: string; excerpt: string };

/**
 * ⌘K: boards and notes by name. What the browser holds answers at once (offline too, and
 * for Chinese, which full-text search cannot split into words); the server's full-text
 * search, which also reads long bodies, fills in a moment later.
 */
export function CommandPalette({ data, onClose }: { data: Data; onClose: () => void }) {
  const t = useTranslations('app');
  const { store, openNote, showBoard } = useWorkspace();
  const dialog = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [hits, setHits] = useState<{ q: string; hits: SearchHit[] }>({ q: '', hits: [] });

  useEffect(() => {
    const d = dialog.current;
    if (d && !d.open) d.showModal();
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2 || !navigator.onLine) return;
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      store
        .search(q, ctrl.signal)
        .then((h) => setHits({ q, hits: h }))
        .catch(() => {});
    }, 200);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [query, store]);

  const items = useMemo<Item[]>(() => {
    const q = query.trim();
    if (!q) {
      return boardsOf(data.boards).map((b) => ({ kind: 'board' as const, id: b.id, title: b.title, where: '' }));
    }
    const fq = fold(q);
    const out: Item[] = boardsOf(data.boards)
      .filter((b) => fold(b.title).includes(fq))
      .slice(0, 5)
      .map((b) => ({ kind: 'board', id: b.id, title: b.title, where: '' }));
    const seen = new Set<string>();
    const pushNote = (id: string) => {
      const w = locate(data, id);
      if (!w || seen.has(id)) return;
      seen.add(id);
      out.push({ kind: 'note', id, title: w.note.title || w.note.excerpt || t('note.untitled'), where: `${w.board.title} / ${w.lane.title}`, excerpt: w.note.title ? w.note.excerpt : '' });
    };
    for (const n of localSearch(data, q, 12)) pushNote(n.id);
    if (hits.q === q) for (const h of hits.hits) pushNote(h.id);
    return out.slice(0, 25);
  }, [data, query, hits, t]);

  const choose = (item: Item | undefined) => {
    if (!item) return;
    onClose();
    if (item.kind === 'board') showBoard(item.id);
    else openNote(item.id);
  };

  const at = Math.min(active, Math.max(0, items.length - 1));

  return (
    <dialog ref={dialog} className="w-palette" aria-label={t('search')} onClose={onClose} onClick={(e) => e.target === dialog.current && dialog.current?.close()}>
      <div className="w-palette__box">
        <div className="w-palette__field">
          <IconSearch />
          <input
            className="w-palette__input"
            role="combobox"
            aria-expanded="true"
            aria-controls="w-palette-list"
            aria-activedescendant={items[at] ? `w-pal-${at}` : undefined}
            aria-label={t('search')}
            placeholder={t('searchPlaceholder')}
            value={query}
            autoFocus
            maxLength={200}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((at + 1) % Math.max(1, items.length));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((at - 1 + items.length) % Math.max(1, items.length));
              } else if (e.key === 'Enter' && !isComposing(e)) {
                e.preventDefault();
                choose(items[at]);
              }
            }}
          />
          <kbd className="nr-kbd">Esc</kbd>
        </div>
        <ul id="w-palette-list" className="w-palette__list" role="listbox" aria-label={t('search')}>
          {items.map((item, i) => (
            <li
              key={`${item.kind}:${item.id}`}
              id={`w-pal-${i}`}
              role="option"
              aria-selected={i === at}
              className="w-palette__item"
              onMouseMove={() => i !== at && setActive(i)}
              onClick={() => choose(item)}
            >
              <span className="w-palette__icon">{item.kind === 'note' ? <IconNote /> : data.boards.get(item.id)?.icon ? <BoardGlyph icon={data.boards.get(item.id)!.icon} /> : <IconBoard />}</span>
              <span className="w-palette__text">
                <span className="w-palette__title">{item.title}</span>
                {item.kind === 'note' && item.excerpt && <span className="w-palette__excerpt">{item.excerpt}</span>}
              </span>
              {item.where && <span className="w-palette__where">{item.where}</span>}
            </li>
          ))}
          {items.length === 0 && <li className="w-palette__empty">{t('searchEmpty')}</li>}
        </ul>
      </div>
    </dialog>
  );
}
