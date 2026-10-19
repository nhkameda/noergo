import { getDb } from '@noergo/core/db';
import type { Adapter, AdapterPayload } from 'oidc-provider';

/**
 * oidc-provider's storage (clients, grants, codes, tokens, interactions) in the
 * oidc_payloads table. Tokens are opaque: what the client holds is the id of a row here,
 * so revoking a connection is deleting its grant's rows.
 */
export class KyselyAdapter implements Adapter {
  constructor(private readonly name: string) {}

  async upsert(id: string, payload: AdapterPayload, expiresIn: number): Promise<void> {
    const values = {
      payload: JSON.stringify(payload),
      grant_id: payload.grantId ?? null,
      user_code: payload.userCode ?? null,
      uid: payload.uid ?? null,
      expires_at: expiresIn ? new Date(Date.now() + expiresIn * 1000) : null,
    };
    await getDb()
      .insertInto('oidc_payloads')
      .values({ id, type: this.name, ...values })
      .onConflict((oc) => oc.columns(['id', 'type']).doUpdateSet(values))
      .execute();
  }

  private async findBy(column: 'id' | 'uid' | 'user_code', value: string): Promise<AdapterPayload | undefined> {
    const row = await getDb()
      .selectFrom('oidc_payloads')
      .select(['payload', 'consumed_at'])
      .where(column, '=', value)
      .where('type', '=', this.name)
      .where((eb) => eb.or([eb('expires_at', 'is', null), eb('expires_at', '>', new Date())]))
      .executeTakeFirst();
    if (!row) return undefined;
    return { ...(row.payload as AdapterPayload), ...(row.consumed_at ? { consumed: Math.floor(new Date(row.consumed_at).getTime() / 1000) } : {}) };
  }

  find(id: string) {
    return this.findBy('id', id);
  }

  findByUid(uid: string) {
    return this.findBy('uid', uid);
  }

  findByUserCode(userCode: string) {
    return this.findBy('user_code', userCode);
  }

  async consume(id: string): Promise<void> {
    await getDb().updateTable('oidc_payloads').set({ consumed_at: new Date() }).where('id', '=', id).where('type', '=', this.name).execute();
  }

  async destroy(id: string): Promise<void> {
    await getDb().deleteFrom('oidc_payloads').where('id', '=', id).where('type', '=', this.name).execute();
  }

  async revokeByGrantId(grantId: string): Promise<void> {
    await getDb().deleteFrom('oidc_payloads').where('grant_id', '=', grantId).execute();
  }
}
