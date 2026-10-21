import type { Board, CoverFrame, Lane, Link, LinkStyle, NodeLayout, Note } from './db/types';
import { LIMITS } from './limits';

/**
 * Public shapes. The same objects travel in snapshots, live events and MCP results;
 * internal columns (workspace_id, fts) never leave the server.
 */

export interface BoardDto {
  id: string;
  title: string;
  color: string | null;
  /** One emoji or a line icon's name (`BOARD_ICONS`). */
  icon: string | null;
  /** The colour behind the board's thoughts. */
  background: string | null;
  position: string;
  version: number;
  updatedAt: string;
  deletedAt: string | null;
}

/** A column's cover: the image (served at /api/files/:fileId) and how it is framed. */
export interface LaneCover extends CoverFrame {
  fileId: string;
}

export interface LaneDto {
  id: string;
  boardId: string;
  title: string;
  color: string | null;
  cover: LaneCover | null;
  /** The thought's website, absolute http(s). */
  url: string | null;
  /** A line or a paragraph under the title; '' when there is none. */
  description: string;
  position: string;
  version: number;
  updatedAt: string;
  deletedAt: string | null;
}

export interface NoteDto {
  id: string;
  laneId: string;
  position: string;
  kind: Note['kind'];
  title: string;
  /** Absent when the note is long and travelled as an excerpt; fetch it on open. */
  body?: string;
  excerpt: string;
  bodyLength: number;
  url: string | null;
  attachmentId: string | null;
  color: string | null;
  tags: string[];
  doneAt: string | null;
  dueAt: string | null;
  /** What hangs from it (its links out, down the tree) is hidden in the column and on the map. */
  collapsed: boolean;
  version: number;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface LinkDto {
  id: string;
  from: { kind: Link['from_kind']; id: string };
  to: { kind: Link['to_kind']; id: string };
  origin: Link['origin'];
  label: string;
  style: LinkStyle;
  version: number;
  updatedBy: string | null;
  deletedAt: string | null;
}

export interface LayoutDto {
  viewKind: NodeLayout['view_kind'];
  viewId: string;
  nodeKind: NodeLayout['node_kind'];
  nodeId: string;
  x: number;
  y: number;
  shape: NodeLayout['shape'];
  fill: NodeLayout['fill'];
  size: NodeLayout['size'];
  color: string | null;
  version: number;
}

const iso = (d: Date | string | null): string | null => (d === null ? null : new Date(d).toISOString());
const isoReq = (d: Date | string): string => new Date(d).toISOString();

export function excerptOf(body: string): string {
  const flat = body.replace(/\s+/g, ' ').trim();
  return flat.length > LIMITS.excerpt ? `${flat.slice(0, LIMITS.excerpt - 1)}…` : flat;
}

export const boardDto = (b: Board): BoardDto => ({
  id: b.id,
  title: b.title,
  color: b.color,
  icon: b.icon,
  background: b.background,
  position: b.position,
  version: b.version,
  updatedAt: isoReq(b.updated_at),
  deletedAt: iso(b.deleted_at),
});

export const laneDto = (l: Lane): LaneDto => ({
  id: l.id,
  boardId: l.board_id,
  title: l.title,
  color: l.color,
  cover: l.cover_id && l.cover ? { fileId: l.cover_id, ...l.cover } : null,
  url: l.url,
  description: l.description,
  position: l.position,
  version: l.version,
  updatedAt: isoReq(l.updated_at),
  deletedAt: iso(l.deleted_at),
});

export function noteDto(n: Note, opts: { fullBody?: boolean } = {}): NoteDto {
  const inline = opts.fullBody || n.body.length <= LIMITS.snapshotBodyInline;
  return {
    id: n.id,
    laneId: n.lane_id,
    position: n.position,
    kind: n.kind,
    title: n.title,
    ...(inline ? { body: n.body } : {}),
    excerpt: excerptOf(n.body),
    bodyLength: n.body.length,
    url: n.url,
    attachmentId: n.attachment_id,
    color: n.color,
    tags: n.tags,
    doneAt: iso(n.done_at),
    dueAt: iso(n.due_at),
    collapsed: n.collapsed,
    version: n.version,
    createdBy: n.created_by,
    updatedBy: n.updated_by,
    createdAt: isoReq(n.created_at),
    updatedAt: isoReq(n.updated_at),
    deletedAt: iso(n.deleted_at),
  };
}

export const linkDto = (l: Link): LinkDto => ({
  id: l.id,
  from: { kind: l.from_kind, id: l.from_id },
  to: { kind: l.to_kind, id: l.to_id },
  origin: l.origin,
  label: l.label,
  style: l.style ?? {},
  version: l.version,
  updatedBy: l.updated_by,
  deletedAt: iso(l.deleted_at),
});

export const layoutDto = (n: NodeLayout): LayoutDto => ({
  viewKind: n.view_kind,
  viewId: n.view_id,
  nodeKind: n.node_kind,
  nodeId: n.node_id,
  x: n.x,
  y: n.y,
  shape: n.shape,
  fill: n.fill,
  size: n.size,
  color: n.color,
  version: n.version,
});

/** One entity change, as broadcast to browsers and stored in the change log. */
export type Effect =
  | { kind: 'board'; data: BoardDto }
  | { kind: 'lane'; data: LaneDto }
  | { kind: 'note'; data: NoteDto }
  | { kind: 'link'; data: LinkDto }
  | { kind: 'layout'; data: LayoutDto }
  | { kind: 'layout.removed'; data: Pick<LayoutDto, 'viewKind' | 'viewId' | 'nodeKind' | 'nodeId'> };
