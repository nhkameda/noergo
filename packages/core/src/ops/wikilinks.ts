import { sql, type Tx } from '../db';
import type { Note } from '../db/types';
import { linkDto, noteDto } from '../dto';
import { newId } from '../ids';
import type { ChangeEffect, OpCtx } from './apply';

/**
 * [[Title]], [[Title|alias]] and [[note:<uuid>]] in a note body become links with origin
 * 'wikilink'. They are resolved when the body is written and stored by id; renaming a
 * note rewrites the [[Old title]] text in the notes that point to it, as Obsidian does.
 * Links inside code spans and fenced blocks are ignored.
 */

const MAX_PER_NOTE = 200;
const WIKILINK = /\[\[([^[\]\n|]{1,300})(?:\|([^[\]\n]{0,300}))?\]\]/g;
const CODE = /(```[\s\S]*?```|`[^`\n]*`)/;
const BY_ID = /^note:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

export interface WikiTarget {
  id?: string;
  title?: string;
}

/** Splits text into [prose, code, prose, code, …]; only even segments are prose. */
const segments = (body: string) => body.split(CODE);

export function parseWikilinks(body: string): WikiTarget[] {
  const out: WikiTarget[] = [];
  const seen = new Set<string>();
  segments(body).forEach((part, i) => {
    if (i % 2) return;
    for (const m of part.matchAll(WIKILINK)) {
      const raw = (m[1] ?? '').trim();
      if (!raw) continue;
      const byId = BY_ID.exec(raw);
      const target = byId ? { id: byId[1]!.toLowerCase() } : { title: raw };
      const key = target.id ? `id:${target.id}` : `t:${raw.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(target);
      if (out.length >= MAX_PER_NOTE) return;
    }
  });
  return out.slice(0, MAX_PER_NOTE);
}

/** Replaces [[old]] and [[old|alias]] with the new title, outside code. */
export function renameInBody(body: string, oldTitle: string, newTitle: string): string {
  const old = oldTitle.trim().toLowerCase();
  return segments(body)
    .map((part, i) =>
      i % 2
        ? part
        : part.replace(WIKILINK, (whole, target: string, alias: string | undefined) =>
            target.trim().toLowerCase() === old ? `[[${newTitle}${alias !== undefined ? `|${alias}` : ''}]]` : whole,
          ),
    )
    .join('');
}

async function resolve(tx: Tx, ctx: OpCtx, targets: WikiTarget[], selfId: string): Promise<{ ids: string[]; missing: string[] }> {
  const ids = targets.flatMap((t) => (t.id ? [t.id] : []));
  const titles = [...new Set(targets.flatMap((t) => (t.title ? [t.title.toLowerCase()] : [])))];
  const found = new Set<string>();
  const matched = new Set<string>();
  if (ids.length) {
    const rows = await tx.selectFrom('notes').select('id').where('workspace_id', '=', ctx.workspaceId).where('deleted_at', 'is', null).where('id', 'in', ids).execute();
    for (const r of rows) found.add(r.id);
  }
  if (titles.length) {
    // Several notes may share a title: the oldest one wins, so the choice is stable.
    const rows = await tx
      .selectFrom('notes')
      .select(['id', sql<string>`lower(title)`.as('t')])
      .distinctOn(sql`lower(title)`)
      .where('workspace_id', '=', ctx.workspaceId)
      .where('deleted_at', 'is', null)
      .where(sql<boolean>`lower(title) = ANY(${titles}::text[])`)
      .orderBy(sql`lower(title)`)
      .orderBy('created_at', 'asc')
      .orderBy('id', 'asc')
      .execute();
    for (const r of rows) {
      found.add(r.id);
      matched.add(r.t);
    }
  }
  found.delete(selfId);
  return { ids: [...found], missing: titles.filter((t) => !matched.has(t)) };
}

/** Makes the wikilink links leaving `note` match its body. */
export async function syncWikilinks(tx: Tx, ctx: OpCtx, note: Note): Promise<ChangeEffect[]> {
  const ws = ctx.workspaceId;
  const { ids, missing } = await resolve(tx, ctx, parseWikilinks(note.body), note.id);
  const wanted = new Set(ids);

  await tx.deleteFrom('unresolved_wikilinks').where('workspace_id', '=', ws).where('note_id', '=', note.id).execute();
  if (missing.length) {
    await tx
      .insertInto('unresolved_wikilinks')
      .values(missing.map((title_lower) => ({ workspace_id: ws, note_id: note.id, title_lower })))
      .onConflict((oc) => oc.doNothing())
      .execute();
  }

  const current = await tx
    .selectFrom('links')
    .selectAll()
    .where('workspace_id', '=', ws)
    .where('origin', '=', 'wikilink')
    .where('from_kind', '=', 'note')
    .where('from_id', '=', note.id)
    .where('deleted_at', 'is', null)
    .forUpdate()
    .execute();

  const effects: ChangeEffect[] = [];
  const have = new Set<string>();
  for (const link of current) {
    if (link.to_kind === 'note' && wanted.has(link.to_id)) {
      have.add(link.to_id);
      continue;
    }
    const row = await tx
      .updateTable('links')
      .set({ deleted_at: new Date(), updated_by: ctx.actorId, updated_at: new Date(), version: link.version + 1 })
      .where('id', '=', link.id)
      .where('workspace_id', '=', ws)
      .returningAll()
      .executeTakeFirstOrThrow();
    effects.push({ before: { kind: 'link', data: linkDto(link) }, after: { kind: 'link', data: linkDto(row) } });
  }
  for (const to of wanted) {
    if (have.has(to)) continue;
    const row = await tx
      .insertInto('links')
      .values({ id: newId(), workspace_id: ws, from_kind: 'note', from_id: note.id, to_kind: 'note', to_id: to, origin: 'wikilink', created_by: ctx.actorId, updated_by: ctx.actorId })
      .returningAll()
      .executeTakeFirstOrThrow();
    effects.push({ before: null, after: { kind: 'link', data: linkDto(row) } });
  }
  return effects;
}

/** A note titled `title` now exists: link the notes that were waiting for it. */
export async function resolvePending(tx: Tx, ctx: OpCtx, title: string): Promise<ChangeEffect[]> {
  const key = title.trim().toLowerCase();
  if (!key) return [];
  const waiting = await tx
    .selectFrom('unresolved_wikilinks')
    .innerJoin('notes', (j) => j.onRef('notes.id', '=', 'unresolved_wikilinks.note_id').onRef('notes.workspace_id', '=', 'unresolved_wikilinks.workspace_id'))
    .selectAll('notes')
    .where('unresolved_wikilinks.workspace_id', '=', ctx.workspaceId)
    .where('unresolved_wikilinks.title_lower', '=', key)
    .where('notes.deleted_at', 'is', null)
    .limit(MAX_PER_NOTE)
    .forUpdate('notes')
    .execute();
  const effects: ChangeEffect[] = [];
  for (const src of waiting) effects.push(...(await syncWikilinks(tx, ctx, src)));
  return effects;
}

/**
 * After `note` was renamed from oldTitle, rewrite [[oldTitle]] in the notes that link to it
 * by wikilink, so the text keeps matching the graph.
 */
export async function propagateRename(tx: Tx, ctx: OpCtx, note: Note, oldTitle: string): Promise<ChangeEffect[]> {
  const ws = ctx.workspaceId;
  if (!oldTitle.trim() || !note.title.trim() || /[[\]|]/.test(note.title)) return [];
  const sources = await tx
    .selectFrom('links')
    .innerJoin('notes', (j) => j.onRef('notes.id', '=', 'links.from_id').onRef('notes.workspace_id', '=', 'links.workspace_id'))
    .selectAll('notes')
    .where('links.workspace_id', '=', ws)
    .where('links.origin', '=', 'wikilink')
    .where('links.to_kind', '=', 'note')
    .where('links.to_id', '=', note.id)
    .where('links.deleted_at', 'is', null)
    .where('notes.deleted_at', 'is', null)
    .where('notes.id', '!=', note.id)
    .limit(MAX_PER_NOTE)
    .forUpdate('notes')
    .execute();

  const effects: ChangeEffect[] = [];
  for (const src of sources) {
    const body = renameInBody(src.body, oldTitle, note.title);
    if (body === src.body) continue;
    const row = await tx
      .updateTable('notes')
      .set({ body, updated_by: ctx.actorId, updated_at: new Date(), version: src.version + 1 })
      .where('id', '=', src.id)
      .where('workspace_id', '=', ws)
      .returningAll()
      .executeTakeFirstOrThrow();
    effects.push({ before: { kind: 'note', data: noteDto(src, { fullBody: true }) }, after: { kind: 'note', data: noteDto(row, { fullBody: true }) } });
  }
  return effects;
}
