import { createHash } from 'node:crypto';
import { withWorkspace, type Db } from './db';
import { DomainError, notFound } from './errors';
import { newId } from './ids';
import { LIMITS } from './limits';

export type StoredImageMime = 'image/webp' | 'image/png' | 'image/jpeg';

export interface StoredFile {
  id: string;
  mime: string;
  width: number;
  height: number;
  size: number;
}

const stored = (r: { id: string; mime: string; width: number | null; height: number | null; size_bytes: number | string }): StoredFile => ({
  id: r.id,
  mime: r.mime,
  width: r.width ?? 0,
  height: r.height ?? 0,
  size: Number(r.size_bytes),
});

/**
 * Keeps an image the caller has already decoded and re-encoded (apps/web does it with
 * sharp; nothing here trusts the bytes to be what they claim). The quota is checked and
 * charged in one statement, so parallel uploads cannot slip past it together. The same
 * bytes twice are stored, and charged, once.
 */
export async function storeImage(
  ctx: { workspaceId: string; actorId: string },
  img: { bytes: Uint8Array; mime: StoredImageMime; width: number; height: number; name?: string },
  db?: Db,
): Promise<StoredFile> {
  const size = img.bytes.byteLength;
  if (size === 0 || size > LIMITS.imageStoredBytes) throw new DomainError('invalid', `a stored image holds at most ${LIMITS.imageStoredBytes} bytes`);
  if (!Number.isInteger(img.width) || !Number.isInteger(img.height) || img.width < 1 || img.height < 1) throw new DomainError('invalid', 'image without a size');
  const sha256 = createHash('sha256').update(img.bytes).digest('hex');
  const ws = ctx.workspaceId;
  return withWorkspace(
    ws,
    async (tx) => {
      const same = await tx
        .selectFrom('attachments')
        .select(['id', 'mime', 'width', 'height', 'size_bytes'])
        .where('workspace_id', '=', ws)
        .where('sha256', '=', sha256)
        .where('status', '=', 'ready')
        .where('deleted_at', 'is', null)
        .executeTakeFirst();
      if (same) return stored(same);
      const charged = await tx
        .updateTable('workspaces')
        .set((eb) => ({ storage_bytes: eb('storage_bytes', '+', size) }))
        .where('id', '=', ws)
        .where((eb) => eb(eb('storage_bytes', '+', size), '<=', eb.ref('storage_quota_bytes')))
        .returning('id')
        .executeTakeFirst();
      if (!charged) throw new DomainError('limit_reached', 'the storage quota of this workspace is full');
      const id = newId();
      const row = await tx
        .insertInto('attachments')
        .values({
          id,
          workspace_id: ws,
          storage_key: `db/${id}`,
          status: 'ready',
          mime: img.mime,
          size_bytes: size,
          sha256,
          name: (img.name ?? '').slice(0, 300),
          width: img.width,
          height: img.height,
          content: Buffer.from(img.bytes),
          created_by: ctx.actorId,
        })
        .returning(['id', 'mime', 'width', 'height', 'size_bytes'])
        .executeTakeFirstOrThrow();
      return stored(row);
    },
    { db },
  );
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The bytes of a stored file. Ids of another workspace answer not_found, like missing ones. */
export async function readFile(workspaceId: string, id: string, db?: Db): Promise<{ bytes: Buffer; mime: string; sha256: string }> {
  if (!UUID.test(id)) throw notFound('file');
  const row = await withWorkspace(
    workspaceId,
    (tx) =>
      tx
        .selectFrom('attachments')
        .select(['content', 'mime', 'sha256'])
        .where('id', '=', id)
        .where('workspace_id', '=', workspaceId)
        .where('status', '=', 'ready')
        .where('deleted_at', 'is', null)
        .executeTakeFirst(),
    { db },
  );
  if (!row?.content) throw notFound('file');
  return { bytes: row.content, mime: row.mime, sha256: row.sha256 ?? '' };
}
