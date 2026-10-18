'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { useMemo } from 'react';
import { useWorkspace } from './context';
import { IconCheck } from './icons';
import { colorName, dueNotes, type Data, type DueItem } from './model';

const GROUPS = ['overdue', 'today', 'upcoming'] as const;

/** Open notes with a due date, from every board: what needs doing, soonest first. */
export function DueList({ data }: { data: Data }) {
  const t = useTranslations('app');
  const format = useFormatter();
  const { actions, openNote } = useWorkspace();
  const items = useMemo(() => dueNotes(data), [data]);
  const groups = GROUPS.map((g) => ({ g, items: items.filter((i) => i.group === g) })).filter((x) => x.items.length);

  if (!items.length) {
    return (
      <div className="nr-vazio w-due-list">
        <strong>{t('dueTitle')}</strong>
        <span>{t('dueEmpty')}</span>
      </div>
    );
  }

  const row = ({ note, lane, board, group }: DueItem) => (
    <li key={note.id} className="w-due-row">
      <button type="button" className="w-check" aria-pressed={false} aria-label={t('note.markDone')} title={t('note.markDone')} onClick={() => actions.toggleDone(note)}>
        {note.doneAt && <IconCheck />}
      </button>
      <button type="button" className="w-due-row__main" data-cor={colorName(note.color)} onClick={() => openNote(note.id)}>
        <span className="w-due-row__title">{note.title || note.excerpt || t('note.untitled')}</span>
        <span className="w-muted">
          {board.title} / {lane.title}
        </span>
      </button>
      <span className={`w-due${group === 'overdue' ? ' w-due--late' : ''}`}>{format.dateTime(new Date(note.dueAt!), { weekday: 'short', day: 'numeric', month: 'short' })}</span>
    </li>
  );

  return (
    <div className="w-due-list">
      <h2 className="nr-h3">{t('dueTitle')}</h2>
      {groups.map(({ g, items: list }) => (
        <section key={g} aria-labelledby={`due-${g}`}>
          <h3 id={`due-${g}`} className="w-due-list__group">
            {t(g)} <span className="w-muted">{list.length}</span>
          </h3>
          <ul className="w-due-list__items">{list.map(row)}</ul>
        </section>
      ))}
    </div>
  );
}
