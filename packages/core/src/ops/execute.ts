import { sql, withWorkspace, type Db, getDb } from '../db';
import type { Effect } from '../dto';
import { DomainError, isDomainError, type DomainErrorCode } from '../errors';
import { applyOp, type OpCtx } from './apply';
import type { Envelope } from './schema';

export interface ExecCtx extends OpCtx {
  /** Read-only agent connections and tokens may read but never write. */
  readOnly?: boolean;
}

export type OpOutcome =
  | { opId: string; status: 'applied'; seq: number | null; result: Record<string, unknown>; effects: Effect[] }
  | { opId: string; status: 'conflict' | 'rejected'; error: { code: DomainErrorCode; message: string; details?: Record<string, unknown> } };

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
  for (const { opId, op } of envelopes) {
    if (ctx.readOnly) {
      outcomes.push({ opId, status: 'rejected', error: { code: 'read_only_connection', message: 'this connection is read-only' } });
      continue;
    }
    try {
      outcomes.push(
        await withWorkspace(
          ctx.workspaceId,
          async (tx) => {
            const ws = await tx.selectFrom('workspaces').select('seq').where('id', '=', ctx.workspaceId).forUpdate().executeTakeFirst();
            if (!ws) throw new DomainError('not_found', 'workspace not found');

            const receipt = await tx.selectFrom('op_receipts').select('result').where('workspace_id', '=', ctx.workspaceId).where('op_id', '=', opId).executeTakeFirst();
            if (receipt) return receipt.result as OpOutcome;

            const applied = await applyOp(tx, ctx, op);
            let seq: number | null = null;
            if (applied.effects.length) {
              seq = ws.seq + 1;
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
          },
          { db },
        ),
      );
    } catch (e) {
      const err = toDomain(e);
      outcomes.push({
        opId,
        status: err.code === 'version_conflict' ? 'conflict' : 'rejected',
        error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) },
      });
    }
  }
  return outcomes;
}
