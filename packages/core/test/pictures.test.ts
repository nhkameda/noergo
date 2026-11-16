import { afterAll, describe, expect, it } from 'vitest';
import { storeImage } from '../src/files';
import { newId } from '../src/ids';
import { executeOps, type OpOutcome } from '../src/ops/execute';
import type { Op } from '../src/ops/schema';
import { snapshot } from '../src/read';
import { createShare, executeSharedOps, resolveShare, sharedFile } from '../src/shares';
import { closePools, newAccount, pools, testDb } from './fixtures';

const run = (ctx: Parameters<typeof executeOps>[0], ...ops: Op[]) => executeOps(ctx, ops.map((op) => ({ opId: newId(), op })), pools().app);

function applied(o: OpOutcome | undefined) {
  if (!o || o.status !== 'applied') throw new Error(`expected applied, got ${JSON.stringify(o)}`);
  return o;
}

/** An image as the web app stores it once re-encoded; core does not look inside the bytes. */
const picture = (ctx: { workspaceId: string; actorId: string }, w = 400, h = 300) =>
  storeImage(ctx, { bytes: new Uint8Array([w % 251, h % 251, 7, 9]), mime: 'image/webp', width: w, height: h }, pools().app);

describe.skipIf(!testDb)('picture ideas', () => {
  afterAll(closePools);

  it('an idea can be a picture, carries its size, and goes back to text', async () => {
    const a = await newAccount();
    const lane = (await snapshot(a.workspaceId, pools().app)).lanes[0]!;
    const file = await picture(a.ctx, 400, 300);
    const id = newId();
    applied((await run(a.ctx, { type: 'note.create', id, laneId: lane.id, title: 'chart', attachmentId: file.id }))[0]);
    let note = (await snapshot(a.workspaceId, pools().app)).notes.find((n) => n.id === id)!;
    expect(note).toMatchObject({ kind: 'image', attachmentId: file.id, image: { w: 400, h: 300 } });

    const tall = await picture(a.ctx, 300, 900);
    applied((await run(a.ctx, { type: 'note.update', id, attachmentId: tall.id }))[0]);
    note = (await snapshot(a.workspaceId, pools().app)).notes.find((n) => n.id === id)!;
    expect(note).toMatchObject({ kind: 'image', attachmentId: tall.id, image: { w: 300, h: 900 } });

    applied((await run(a.ctx, { type: 'note.update', id, attachmentId: null }))[0]);
    note = (await snapshot(a.workspaceId, pools().app)).notes.find((n) => n.id === id)!;
    expect(note).toMatchObject({ kind: 'text', attachmentId: null, image: null });

    // A text idea becomes a picture; a link keeps its address and becomes a link again.
    applied((await run(a.ctx, { type: 'note.update', id, url: 'https://example.com', attachmentId: file.id }))[0]);
    applied((await run(a.ctx, { type: 'note.update', id, attachmentId: null }))[0]);
    note = (await snapshot(a.workspaceId, pools().app)).notes.find((n) => n.id === id)!;
    expect(note).toMatchObject({ kind: 'link', url: 'https://example.com', image: null });
  });

  it('takes only a picture of its own workspace', async () => {
    const a = await newAccount();
    const b = await newAccount();
    const lane = (await snapshot(a.workspaceId, pools().app)).lanes[0]!;
    const theirs = await picture(b.ctx);
    const [o] = await run(a.ctx, { type: 'note.create', id: newId(), laneId: lane.id, title: 'x', attachmentId: theirs.id });
    expect(o).toMatchObject({ status: 'rejected', error: { code: 'not_found' } });
  });

  it('a shared link shows the pictures it opens but adds none', async () => {
    const owner = await newAccount();
    const visitor = await newAccount();
    const app = pools().app;
    const lane = (await snapshot(owner.workspaceId, app)).lanes[0]!;
    const file = await picture(owner.ctx);
    applied((await run(owner.ctx, { type: 'note.create', id: newId(), laneId: lane.id, title: '', attachmentId: file.id }))[0]);
    const share = await createShare(owner, { kind: 'lane', id: lane.id }, 'edit', app);
    const link = (await resolveShare(share.id, app))!;
    expect((await sharedFile(link, file.id, app)).bytes.byteLength).toBe(4);
    const [o] = await executeSharedOps(link, visitor.userId, [{ opId: newId(), op: { type: 'note.create', id: newId(), laneId: lane.id, title: 'x', attachmentId: file.id } }], app);
    expect(o).toMatchObject({ status: 'rejected', error: { code: 'forbidden' } });
  });
});
