import { afterAll, describe, expect, it } from 'vitest';
import { withUser } from '../src/db';
import {
  endAllSessions,
  googleIdentity,
  MICROSOFT_CONSUMER_TENANT,
  microsoftIdentity,
  oidcIdentity,
  sessionState,
  signInFederated,
  signupAllowed,
  type FederatedIdentity,
  type SignInPolicy,
} from '../src/identity';
import { newId } from '../src/ids';
import { closePools, pools, testDb } from './fixtures';

const OPEN: SignInPolicy = { signup: 'open', allowlist: [], adminEmails: [] };

describe('identity claims', () => {
  it('trusts Google as the owner of Gmail and Workspace mailboxes only', () => {
    expect(googleIdentity({ sub: '1', email: 'Ana@Gmail.com', email_verified: true })).toMatchObject({ email: 'ana@gmail.com', emailVerified: true, authoritative: true });
    expect(googleIdentity({ sub: '1', email: 'ana@acme.com', email_verified: true, hd: 'acme.com' })).toMatchObject({ authoritative: true });
    // A Google account opened with another provider's mailbox.
    expect(googleIdentity({ sub: '1', email: 'ana@yahoo.com', email_verified: true })).toMatchObject({ emailVerified: true, authoritative: false });
    expect(googleIdentity({ sub: '1', email: 'ana@gmail.com', email_verified: false })).toMatchObject({ emailVerified: false, authoritative: false });
    expect(googleIdentity({ email: 'ana@gmail.com' })).toBeNull();
  });

  it('treats a Microsoft work-tenant e-mail as a claim, not a proof', () => {
    const work = microsoftIdentity({ sub: 's', tid: 'some-tenant', email: 'ceo@bank.com' });
    expect(work).toMatchObject({ emailVerified: false, authoritative: false });
    expect(microsoftIdentity({ sub: 's', tid: 'some-tenant', email: 'ceo@bank.com', xms_edov: true })).toMatchObject({ emailVerified: true, authoritative: false });
    expect(microsoftIdentity({ sub: 's', tid: MICROSOFT_CONSUMER_TENANT, preferred_username: 'ana@outlook.com' })).toMatchObject({ email: 'ana@outlook.com', emailVerified: true, authoritative: false });
    expect(microsoftIdentity({ sub: 's', tid: MICROSOFT_CONSUMER_TENANT, preferred_username: '+5511999999999' })).toMatchObject({ email: null, emailVerified: false });
  });

  it('never lets a generic OIDC provider merge accounts', () => {
    expect(oidcIdentity({ sub: 'k', email: 'ana@example.org', email_verified: true })).toMatchObject({ emailVerified: true, authoritative: false });
  });

  it('matches the allowlist by address or by @domain', () => {
    const policy: SignInPolicy = { signup: 'allowlist', allowlist: ['ana@example.org', '@acme.com'], adminEmails: [] };
    expect(signupAllowed(policy, 'ana@example.org')).toBe(true);
    expect(signupAllowed(policy, 'bob@acme.com')).toBe(true);
    expect(signupAllowed(policy, 'bob@example.org')).toBe(false);
    expect(signupAllowed(policy, 'bob@notacme.com')).toBe(false);
  });
});

describe.skipIf(!testDb)('federated sign-in', () => {
  afterAll(closePools);

  const google = (email: string, extra: Record<string, unknown> = {}): FederatedIdentity => googleIdentity({ sub: newId(), email, email_verified: true, ...extra })!;
  const microsoft = (email: string): FederatedIdentity => microsoftIdentity({ sub: newId(), tid: MICROSOFT_CONSUMER_TENANT, email })!;
  const gmail = () => `${newId()}@gmail.com`;

  async function workspacesOf(userId: string): Promise<number> {
    return withUser(userId, async (tx) => (await tx.selectFrom('workspaces').select('id').where('owner_id', '=', userId).execute()).length, { db: pools().app });
  }

  it('creates the account and its seeded workspace once, then signs in to it', async () => {
    const id = google(gmail());
    const first = await signInFederated(id, OPEN, 'pt-BR', pools().app);
    expect(first).toMatchObject({ ok: true, created: true, locale: 'pt-BR' });
    const again = await signInFederated(id, OPEN, 'en', pools().app);
    expect(again).toMatchObject({ ok: true, created: false, locale: 'pt-BR' });
    if (!first.ok || !again.ok) throw new Error('unreachable');
    expect(again.userId).toBe(first.userId);
    expect(await workspacesOf(first.userId)).toBe(1);
  });

  it('survives a double-clicked first sign-in with one user and one workspace', async () => {
    const id = google(gmail());
    const results = await Promise.all(Array.from({ length: 5 }, () => signInFederated(id, OPEN, 'en', pools().app)));
    const users = new Set(results.map((r) => (r.ok ? r.userId : r.reason)));
    expect(users.size).toBe(1);
    expect(results.filter((r) => r.ok && r.created)).toHaveLength(1);
    expect(await workspacesOf([...users][0]!)).toBe(1);
  });

  it('lets Google join an existing verified account and refuses Microsoft', async () => {
    const email = gmail();
    const viaMicrosoft = await signInFederated(microsoft(email), OPEN, 'en', pools().app);
    const viaGoogle = await signInFederated(google(email), OPEN, 'en', pools().app);
    expect(viaGoogle.ok && viaMicrosoft.ok && viaGoogle.userId === viaMicrosoft.userId).toBe(true);

    const other = gmail();
    await signInFederated(google(other), OPEN, 'en', pools().app);
    expect(await signInFederated(microsoft(other), OPEN, 'en', pools().app)).toEqual({ ok: false, reason: 'account_not_linked' });
  });

  it('refuses a Google identity that does not own the mailbox', async () => {
    const email = `${newId()}@yahoo.com`;
    await signInFederated(microsoft(email), OPEN, 'en', pools().app);
    expect(await signInFederated(google(email), OPEN, 'en', pools().app)).toEqual({ ok: false, reason: 'account_not_linked' });
  });

  it('refuses unverified and missing addresses', async () => {
    const work = microsoftIdentity({ sub: newId(), tid: 'tenant', email: `${newId()}@gmail.com` })!;
    expect(await signInFederated(work, OPEN, 'en', pools().app)).toEqual({ ok: false, reason: 'email_unverified' });
    const phone = microsoftIdentity({ sub: newId(), tid: MICROSOFT_CONSUMER_TENANT, preferred_username: '+5511999999999' })!;
    expect(await signInFederated(phone, OPEN, 'en', pools().app)).toEqual({ ok: false, reason: 'email_missing' });
  });

  it('closes signup outside the allowlist without locking out existing accounts', async () => {
    const id = google(gmail());
    await signInFederated(id, OPEN, 'en', pools().app);
    const closed: SignInPolicy = { signup: 'allowlist', allowlist: ['@acme.com'], adminEmails: [] };
    expect(await signInFederated(id, closed, 'en', pools().app)).toMatchObject({ ok: true });
    expect(await signInFederated(google(gmail()), closed, 'en', pools().app)).toEqual({ ok: false, reason: 'signup_closed' });
    expect(await signInFederated(google(`${newId()}@acme.com`, { hd: 'acme.com' }), closed, 'en', pools().app)).toMatchObject({ ok: true, created: true });
    // An administrator gets in on a closed instance: the list is theirs to fill.
    const admin = gmail();
    expect(await signInFederated(google(admin), { ...closed, adminEmails: [admin] }, 'en', pools().app)).toMatchObject({ ok: true, created: true });
  });

  it('takes the admin role from configuration on every sign-in', async () => {
    const email = gmail();
    const id = google(email);
    await signInFederated(id, { ...OPEN, adminEmails: [email.toUpperCase()] }, 'en', pools().app);
    const row = () => pools().app.selectFrom('users').select('role').where('email', '=', email).executeTakeFirstOrThrow();
    expect((await row()).role).toBe('admin');
    await signInFederated(id, OPEN, 'en', pools().app);
    expect((await row()).role).toBe('user');
  });

  it('ends every session when the epoch moves', async () => {
    const r = await signInFederated(google(gmail()), OPEN, 'en', pools().app);
    if (!r.ok) throw new Error(r.reason);
    expect(await sessionState(r.userId, r.sessionEpoch, pools().app)).toMatchObject({ role: 'user' });
    await endAllSessions(r.userId, pools().app);
    expect(await sessionState(r.userId, r.sessionEpoch, pools().app)).toBeNull();
    expect(await sessionState(r.userId, r.sessionEpoch + 1, pools().app)).not.toBeNull();
  });
});
