import { recordConnection } from '@noergo/core';
import { sql } from '@noergo/core/db';
import { afterAll, describe, expect, it } from 'vitest';
import { closePools, newAccount, pools, testDb } from '../../../packages/core/test/fixtures';
import type {} from '../../../packages/core/test/global-setup';
import { JOBS } from '../src/jobs';

const job = (name: string) => JOBS.find((j) => j.name === name)!;
const epoch = (hoursAgo: number) => Math.floor(Date.now() / 1000) - hoursAgo * 3600;

async function payloads(): Promise<string[]> {
  const rows = await pools().jobs.selectFrom('oidc_payloads').select(['type', 'id']).execute();
  return rows.map((r) => `${r.type}:${r.id}`).sort();
}

describe.skipIf(!testDb)('retention', () => {
  afterAll(closePools);

  it('drops expired OAuth state and clients that never became a connection, keeps the rest', async () => {
    const { jobs, app } = pools();
    const acct = await newAccount();
    await jobs.deleteFrom('oidc_payloads').execute();
    const client = (id: string, hoursAgo: number) => ({ id, type: 'Client', payload: JSON.stringify({ client_id: id, client_id_issued_at: epoch(hoursAgo) }) });
    await jobs
      .insertInto('oidc_payloads')
      .values([
        { id: 'old-token', type: 'AccessToken', payload: '{}', expires_at: new Date(Date.now() - 2 * 3600_000) },
        { id: 'live-token', type: 'AccessToken', payload: '{}', expires_at: new Date(Date.now() + 3600_000) },
        client('dcr_unused', 25),
        { id: 'rat-unused', type: 'RegistrationAccessToken', payload: JSON.stringify({ clientId: 'dcr_unused' }) },
        client('dcr_connected', 25),
        client('dcr_new', 1),
        client('https://chatgpt.com/oauth/client.json', 25),
      ])
      .execute();
    await recordConnection({ userId: acct.userId, clientId: 'dcr_connected', grantId: `g-${acct.userId}`, clientName: 'Grok', redirectHost: 'grok.com', scopes: ['notes:read'], readOnly: true }, app);

    expect(await job('oauth-expired').run(jobs)).toBe(1);
    expect(await job('oauth-unused-clients').run(jobs)).toBe(1);
    expect(await payloads()).toEqual(['AccessToken:live-token', 'Client:dcr_connected', 'Client:dcr_new', 'Client:https://chatgpt.com/oauth/client.json']);
  });

  it('keeps the security log and what is on screen only as long as they are any use', async () => {
    const { jobs } = pools();
    const acct = await newAccount();
    await jobs
      .insertInto('security_events')
      .values([
        { key: `old-${acct.userId}`, kind: 'mcp_bearer_refused', last_at: sql`now() - interval '91 days'` },
        { key: `new-${acct.userId}`, kind: 'mcp_bearer_refused' },
      ])
      .execute();
    await jobs.insertInto('user_focus').values({ workspace_id: acct.workspaceId, user_id: acct.userId, view: 'map', at: sql`now() - interval '2 days'` }).execute();

    await job('security-events').run(jobs);
    await job('user-focus').run(jobs);
    const keys = (await jobs.selectFrom('security_events').select('key').where('key', 'like', `%${acct.userId}`).execute()).map((r) => r.key);
    expect(keys).toEqual([`new-${acct.userId}`]);
    expect(await jobs.selectFrom('user_focus').select('user_id').where('user_id', '=', acct.userId).execute()).toEqual([]);
  });
});
