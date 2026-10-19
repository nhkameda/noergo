import { sql, withWorkspace, type Db, type Tx, getDb } from '../db';
import type { Effect } from '../dto';
import { DomainError, isDomainError, type DomainErrorCode } from '../errors';
import { applyOp, type OpCtx } from './apply';
import type { Envelope } from './schema';

export interface ExecCtx extends OpCtx {
  /** Read-only agent connections and tokens may read but never write. */
  readOnly?: boolean;
}

export type AppliedOutcome = { opId: string; status: 'applied'; seq: number | null; result: Record<string, unknown>; effects: Effect[] };
export type RefusedOutcome = { opId: string; status: 'conflict' | 'rejected'; error: { code: DomainErrorCode; message: string; details?: Record<string, unknown> } };
export type OpOutcome = AppliedOutcome | RefusedOutcome;

/** NOTIFY channel; the payload is "<workspace id>:<seq>". */
export const CHANGES_CHANNEL = 'ws';

const PG_TO_DOMAIN: Record<string, DomainErrorCode> = {
  '23505': 'invalid', // unique_violation
  '23503': 'not_found', // foreign_key_violation
  '23514': 'invalid', // check_violation
  '22001': 'invalid', // string_data_right_truncation
};

function toDomain(e: unknown): DomainError {
  if (isDomainError(e)) return e;
  const code = (e as { code?: string } | null)?.code;
  const mapped = code ? PG_TO_DOMAIN[code] : undefined;
  if (mapped) return new DomainError(mapped, mapped === 'not_found' ? 'a referenced item does not exist' : 'the change breaks a data rule');
  throw e;
}

/**
 * Applies operations one by one, each in its own transaction:
 *
 *   lock the workspace row → replay a stored receipt for a known opId → apply →
 *   take the next seq → record the change → store the receipt → NOTIFY → commit
 *
 * The workspace row lock serialises the writers of a workspace, so seq has no gaps and
 * follows commit order (a live stream reading "seq > n" can never skip a change that
 * commits later). An op that changes nothing consumes no seq. A failed op leaves no trace
 * and does not stop the ones after it; ops that depend on it fail on their own.
 */
export async function executeOps(ctx: ExecCtx, envelopes: Envelope[], db: Db = getDb()): Promise<OpOutcome[]> {
  const outcomes: OpOutcome[] = [];
  for (const envelope of envelopes) {
    if (ctx.readOnly) {
      outcomes.push(readOnlyRefusal(envelope.opId));
      continue;
    }
    try {
      outcomes.push(await withWorkspace(ctx.workspaceId, async (tx) => runOne(tx, ctx, await lockWorkspace(tx, ctx), envelope), { db }));
    } catch (e) {
      outcomes.push(refusal(envelope.opId, toDomain(e)));
    }
  }
  return outcomes;
}

/**
 * Applies operations all or nothing, in one transaction: an agent's batch of ideas and the
 * links that hang them on the map lands at once or not at all. Each op still takes its own
 * seq and change row, so the live stream and undo see them one by one. On the first
 * failure everything rolls back and the answer says which op failed.
 */
export async function executeAtomic(
  ctx: ExecCtx,
  envelopes: Envelope[],
  db: Db = getDb(),
): Promise<{ ok: true; outcomes: AppliedOutcome[] } | { ok: false; index: number; outcome: RefusedOutcome }> {
  if (ctx.readOnly) return { ok: false, index: 0, outcome: readOnlyRefusal(envelopes[0]?.opId ?? '') };
  let index = 0;
  try {
    const outcomes = await withWorkspace(
      ctx.workspaceId,
      async (tx) => {
        const ws = await lockWorkspace(tx, ctx);
        const out: AppliedOutcome[] = [];
        for (index = 0; index < envelopes.length; index++) {
          const o = await runOne(tx, ctx, ws, envelopes[index]!);
          if (o.status !== 'applied') throw new DomainError(o.error.code, o.error.message, o.error.details);
          out.push(o);
        }
        return out;
      },
      { db },
    );
    return { ok: true, outcomes };
  } catch (e) {
    const err = toDomain(e);
    return { ok: false, index, outcome: refusal(envelopes[index]?.opId ?? '', err) };
  }
}

const readOnlyRefusal = (opId: string): RefusedOutcome => ({ opId, status: 'rejected', error: { code: 'read_only_connection', message: 'this connection is read-only' } });

function refusal(opId: string, err: DomainError): RefusedOutcome {
  return { opId, status: err.code === 'version_conflict' ? 'conflict' : 'rejected', error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) } };
}

/** Locks the workspace row (first, always: see executeOps) and returns its seq, kept current as ops apply. */
async function lockWorkspace(tx: Tx, ctx: ExecCtx): Promise<{ seq: number }> {
  const ws = await tx.selectFrom('workspaces').select('seq').where('id', '=', ctx.workspaceId).forUpdate().executeTakeFirst();
  if (!ws) throw new DomainError('not_found', 'workspace not found');
  return ws;
}

async function runOne(tx: Tx, ctx: ExecCtx, ws: { seq: number }, { opId, op }: Envelope): Promise<OpOutcome> {
  const receipt = await tx.selectFrom('op_receipts').select('result').where('workspace_id', '=', ctx.workspaceId).where('op_id', '=', opId).executeTakeFirst();
  if (receipt) return receipt.result as OpOutcome;

  const applied = await applyOp(tx, ctx, op);
  let seq: number | null = null;
  if (applied.effects.length) {
    seq = ws.seq + 1;
    ws.seq = seq;
    await tx.updateTable('workspaces').set({ seq }).where('id', '=', ctx.workspaceId).execute();
    await tx
      .insertInto('changes')
      .values({
        workspace_id: ctx.workspaceId,
        seq,
        actor_id: ctx.actorId,
        op_id: opId,
        op: op.type,
        entity_kind: applied.entity.kind,
        entity_id: applied.entity.id,
        effects: JSON.stringify(applied.effects),
      })
      .execute();
  }
  const outcome: OpOutcome = { opId, status: 'applied', seq, result: applied.result, effects: applied.effects.map((e) => e.after) };
  await tx.insertInto('op_receipts').values({ workspace_id: ctx.workspaceId, op_id: opId, result: JSON.stringify(outcome) }).execute();
  if (seq !== null) await sql`SELECT pg_notify(${CHANGES_CHANNEL}, ${`${ctx.workspaceId}:${seq}`})`.execute(tx);
  return outcome;
}
