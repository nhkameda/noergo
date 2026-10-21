import { z } from 'zod';
import { isBoardIcon } from '../board-icons';
import { LIMITS } from '../limits';
import { isPosition } from '../position';

/**
 * The write contract shared by the web client and the MCP tools. Every mutation of
 * content is one of these operations; nothing else writes boards, lanes, notes, links
 * or layouts.
 */

const id = z.uuid();
const color = z.string().regex(/^#[0-9a-f]{6}$/).nullable();
const position = z.string().refine(isPosition, 'invalid position');
const trimmed = (max: number) => z.string().transform((s) => s.trim()).pipe(z.string().max(max));
const tag = z
  .string()
  .transform((s) => s.trim().replace(/^#/, '').toLowerCase())
  .pipe(z.string().min(1).max(LIMITS.tagLength).regex(/^[^\s,]+$/u));
const safeUrl = z
  .string()
  .max(LIMITS.url)
  .refine((u) => {
    try {
      return ['http:', 'https:', 'mailto:'].includes(new URL(u).protocol);
    } catch {
      return false;
    }
  }, 'only http, https and mailto links are allowed');
/** A website: an absolute http(s) address, nothing a click could run. */
const webUrl = z
  .string()
  .trim()
  .max(LIMITS.url)
  .refine((u) => {
    try {
      return ['http:', 'https:'].includes(new URL(u).protocol);
    } catch {
      return false;
    }
  }, 'only http and https addresses are allowed');

/** One emoji or a line icon's name, before a board's title in its tab. */
const boardIcon = z.string().refine(isBoardIcon, 'an icon is one emoji or the name of a noergo icon');

/** Where to put an item: an explicit key (client-computed) or a relative placement. */
export const placement = z.union([
  z.object({ position }),
  z.object({ at: z.enum(['top', 'bottom']) }),
  z.object({ after: id }),
  z.object({ before: id }),
]);
export type Placement = z.infer<typeof placement>;

const nodeRef = z.object({ kind: z.enum(['note', 'lane', 'board']), id });
export type NodeRef = z.infer<typeof nodeRef>;

const linkStyle = z
  .object({
    color: color.optional(),
    width: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(5)]).optional(),
    dash: z.enum(['solid', 'dashed', 'dotted']).optional(),
    route: z.enum(['curve', 'straight', 'elbow']).optional(),
    arrow: z.enum(['none', 'end', 'start', 'both']).optional(),
  })
  .strict();

/**
 * A column's cover: which image and how it sits in the 3:1 frame. w and h are the
 * image's size; the server takes them from the stored file, not from the client.
 */
const cover = z
  .object({
    fileId: id,
    x: z.number().finite().min(-1).max(2),
    y: z.number().finite().min(-1).max(2),
    z: z.number().finite().min(0.2).max(10),
    w: z.number().int().min(1).max(100_000),
    h: z.number().int().min(1).max(100_000),
    bg: color,
  })
  .strict()
  .nullable();
export type CoverInput = z.infer<typeof cover>;

const layoutNode = z.object({
  kind: z.enum(['note', 'lane', 'board']),
  id,
  x: z.number().finite().min(-1_000_000).max(1_000_000),
  y: z.number().finite().min(-1_000_000).max(1_000_000),
  shape: z.enum(['pill', 'rounded', 'rect', 'ellipse', 'diamond', 'plain']).optional(),
  fill: z.enum(['solid', 'soft', 'outline']).optional(),
  size: z.enum(['s', 'm', 'l']).optional(),
  color: color.optional(),
});

export const opSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('board.create'), id, title: trimmed(LIMITS.boardTitle).pipe(z.string().min(1)), color: color.optional(), icon: boardIcon.nullable().optional(), background: color.optional(), place: placement.optional() }),
  z.object({ type: z.literal('board.update'), id, title: trimmed(LIMITS.boardTitle).pipe(z.string().min(1)).optional(), color: color.optional(), icon: boardIcon.nullable().optional(), background: color.optional() }),
  z.object({ type: z.literal('board.move'), id, place: placement }),
  z.object({ type: z.literal('board.delete'), id }),
  z.object({ type: z.literal('board.restore'), id }),

  z.object({ type: z.literal('lane.create'), id, boardId: id, title: trimmed(LIMITS.laneTitle).pipe(z.string().min(1)), color: color.optional(), url: webUrl.nullable().optional(), description: trimmed(LIMITS.laneDescription).optional(), place: placement.optional() }),
  z.object({ type: z.literal('lane.update'), id, title: trimmed(LIMITS.laneTitle).pipe(z.string().min(1)).optional(), color: color.optional(), cover: cover.optional(), url: webUrl.nullable().optional(), description: trimmed(LIMITS.laneDescription).optional() }),
  z.object({ type: z.literal('lane.move'), id, boardId: id.optional(), place: placement }),
  z.object({ type: z.literal('lane.delete'), id }),
  z.object({ type: z.literal('lane.restore'), id }),

  z.object({
    type: z.literal('note.create'),
    id,
    laneId: id,
    title: trimmed(LIMITS.noteTitle),
    body: z.string().max(LIMITS.noteBody).optional(),
    kind: z.enum(['text', 'link']).optional(),
    url: safeUrl.nullable().optional(),
    color: color.optional(),
    tags: z.array(tag).max(LIMITS.tags).optional(),
    dueAt: z.iso.datetime({ offset: true }).nullable().optional(),
    place: placement.optional(),
  }),
  z.object({
    type: z.literal('note.update'),
    id,
    /** Required when replacing the body wholesale; ignored otherwise. */
    baseVersion: z.number().int().positive().optional(),
    title: trimmed(LIMITS.noteTitle).optional(),
    body: z.string().max(LIMITS.noteBody).optional(),
    /** diff-match-patch patch text against the body at baseVersion. */
    bodyPatch: z.string().max(LIMITS.noteBody * 2).optional(),
    appendText: z.string().max(LIMITS.noteBody).optional(),
    replaceText: z.object({ old: z.string().min(1).max(LIMITS.noteBody), new: z.string().max(LIMITS.noteBody) }).optional(),
    url: safeUrl.nullable().optional(),
    color: color.optional(),
    tagsAdd: z.array(tag).max(LIMITS.tags).optional(),
    tagsRemove: z.array(tag).max(LIMITS.tags).optional(),
    done: z.boolean().optional(),
    dueAt: z.iso.datetime({ offset: true }).nullable().optional(),
    /** Hides what hangs from it, in the column and on the map. */
    collapsed: z.boolean().optional(),
  }),
  z.object({ type: z.literal('note.move'), id, laneId: id, place: placement }),
  z.object({ type: z.literal('note.delete'), id }),
  z.object({ type: z.literal('note.restore'), id }),

  z.object({ type: z.literal('link.create'), id, from: nodeRef, to: nodeRef, label: trimmed(LIMITS.linkLabel).optional(), style: linkStyle.optional() }),
  z.object({ type: z.literal('link.update'), id, label: trimmed(LIMITS.linkLabel).optional(), style: linkStyle.optional() }),
  z.object({ type: z.literal('link.delete'), id }),
  /** Undoes link.delete. A link whose ends are in the trash cannot come back before them. */
  z.object({ type: z.literal('link.restore'), id }),

  z.object({
    type: z.literal('layout.set'),
    viewKind: z.enum(['lane_map', 'board_map', 'graph']),
    viewId: id,
    nodes: z.array(layoutNode).min(1).max(500),
  }),
  z.object({
    type: z.literal('layout.remove'),
    viewKind: z.enum(['lane_map', 'board_map', 'graph']),
    viewId: id,
    nodes: z.array(nodeRef).min(1).max(500),
  }),
]);

export type Op = z.infer<typeof opSchema>;
export type OpType = Op['type'];

/** An op as submitted by a client: optional idempotency id plus the operation. */
export const envelopeSchema = z.object({ opId: id, op: opSchema });
export type Envelope = z.infer<typeof envelopeSchema>;

export const batchSchema = z.object({ ops: z.array(envelopeSchema).min(1).max(LIMITS.opsPerBatch) });
