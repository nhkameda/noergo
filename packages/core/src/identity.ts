import { getDb, sql, type Db } from './db';
import type { Locale } from './db/types';
import { createPersonalWorkspaceIn } from './workspace';

/**
 * Who may sign in, and as which account. Framework-free on purpose: the web app feeds
 * it ID-token claims from Auth.js today, and a replacement auth library would feed it
 * the same claims.
 *
 * The rules, in the order they are applied:
 *   1. A known (provider, subject) pair signs in to the account it is linked to.
 *   2. An address that already has an account may gain a new provider only when that
 *      provider is authoritative for the address (Google, for Gmail and Workspace).
 *      Anything else is refused, never merged: an e-mail claim alone is not proof.
 *   3. A new address creates an account only if the provider verified it, and only
 *      while the signup policy allows it.
 * Provider tokens are never stored: noergo signs people in and never calls Google or
 * Microsoft on their behalf.
 */

export type Provider = 'google' | 'microsoft-entra-id' | 'oidc';

/** What a federated sign-in proves, reduced from the provider's ID-token claims. */
export interface FederatedIdentity {
  provider: Provider;
  subject: string;
  /** Lower-cased, or null when the provider sent none. */
  email: string | null;
  /** The provider vouches that the person controls the address. */
  emailVerified: boolean;
  /** Verified, and the provider owns the mailbox itself, so it may join an existing account. */
  authoritative: boolean;
  name: string;
}

type Claims = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 && v.length <= 320 ? v : null);
const emailOf = (v: unknown): string | null => {
  const s = str(v)?.trim().toLowerCase();
  return s && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : null;
};
const nameOf = (claims: Claims, email: string | null): string => (str(claims.name) ?? email?.split('@')[0] ?? '').trim().slice(0, 200);

/**
 * Google verifies every address it reports, but it is the owner of the mailbox only for
 * Gmail and for Workspace domains (the hd claim). A Google account opened with someone's
 * Yahoo address stays valid after that mailbox changes hands, so it may sign in to the
 * account it created and never join another one.
 */
export function googleIdentity(claims: Claims): FederatedIdentity | null {
  const subject = str(claims.sub);
  if (!subject) return null;
  const email = emailOf(claims.email);
  const emailVerified = Boolean(email) && claims.email_verified === true;
  const domain = email?.split('@')[1];
  const authoritative = emailVerified && (domain === 'gmail.com' || domain === 'googlemail.com' || Boolean(str(claims.hd)));
  return { provider: 'google', subject, email, emailVerified, authoritative, name: nameOf(claims, email) };
}

/** The tenant of personal Microsoft accounts (outlook.com, hotmail.com, live.com). */
export const MICROSOFT_CONSUMER_TENANT = '9188040d-6c67-4c5b-b112-36a304b66dad';

/**
 * In a work or school tenant, the email claim is whatever the tenant's admin typed: any
 * tenant can claim any address (the "nOAuth" class of takeovers). It counts as verified
 * only for personal accounts, or when Entra says the domain owner verified it (the
 * optional xms_edov claim, which the app registration must request). Microsoft is never
 * authoritative, so it never joins an account that already exists.
 */
export function microsoftIdentity(claims: Claims): FederatedIdentity | null {
  const subject = str(claims.sub);
  if (!subject) return null;
  const email = emailOf(claims.email) ?? emailOf(claims.preferred_username);
  const edov = claims.xms_edov === true || claims.xms_edov === 1 || claims.xms_edov === '1' || claims.xms_edov === 'true';
  const emailVerified = Boolean(email) && (claims.tid === MICROSOFT_CONSUMER_TENANT || edov);
  return { provider: 'microsoft-entra-id', subject, email, emailVerified, authoritative: false, name: nameOf(claims, email) };
}

/** A self-hosted OpenID Connect provider (Authentik, Keycloak…): trusted to verify, never to merge. */
export function oidcIdentity(claims: Claims): FederatedIdentity | null {
  const subject = str(claims.sub);
  if (!subject) return null;
  const email = emailOf(claims.email);
  const emailVerified = Boolean(email) && claims.email_verified === true;
  return { provider: 'oidc', subject, email, emailVerified, authoritative: false, name: nameOf(claims, email) };
}

export interface SignInPolicy {
  signup: 'open' | 'allowlist';
  /** E-mails, or "@domain" entries, allowed to create an account under "allowlist". */
  allowlist: readonly string[];
  /** Accounts with one of these e-mails are administrators; everyone else is not. */
  adminEmails: readonly string[];
}

export function signupAllowed(policy: SignInPolicy, email: string): boolean {
  if (policy.signup === 'open') return true;
  const domain = `@${email.split('@')[1]}`;
  return policy.allowlist.some((entry) => {
    const e = entry.trim().toLowerCase();
    return e === email || e === domain;
  });
}

export type SignInRefusal = 'email_missing' | 'email_unverified' | 'account_not_linked' | 'signup_closed' | 'account_deleted';

export type SignInResult =
  | { ok: true; userId: string; sessionEpoch: number; locale: Locale; created: boolean }
  | { ok: false; reason: SignInRefusal };

/**
 * Resolves a federated sign-in to a noergo account, creating the account and its
 * personal workspace on first sign-in. User, link and workspace are written in one
 * transaction, serialised per address, so a double-clicked first sign-in creates one
 * of each.
 */
export async function signInFederated(identity: FederatedIdentity, policy: SignInPolicy, locale: Locale, db: Db = getDb()): Promise<SignInResult> {
  const email = identity.email;
  if (!email) return { ok: false, reason: 'email_missing' };

  return db.transaction().execute(async (tx): Promise<SignInResult> => {
    await sql`SELECT pg_advisory_xact_lock(hashtext(${`noergo:signin:${email}`}))`.execute(tx);

    const linked = await tx
      .selectFrom('accounts as a')
      .innerJoin('users as u', 'u.id', 'a.user_id')
      .select(['a.id as accountId', 'u.id', 'u.email', 'u.name', 'u.locale', 'u.role', 'u.session_epoch', 'u.deleted_at'])
      .where('a.provider', '=', identity.provider)
      .where('a.provider_account_id', '=', identity.subject)
      .executeTakeFirst();

    let user: { id: string; email: string; name: string; locale: Locale; role: 'user' | 'admin'; session_epoch: number; deleted_at: Date | null };
    let created = false;

    if (linked) {
      user = linked;
      await tx.updateTable('accounts').set({ last_login_at: new Date() }).where('id', '=', linked.accountId).execute();
    } else {
      const existing = await tx.selectFrom('users').select(['id', 'email', 'name', 'locale', 'role', 'session_epoch', 'deleted_at', 'email_verified_at']).where('email', '=', email).executeTakeFirst();
      if (existing) {
        if (existing.deleted_at) return { ok: false, reason: 'account_deleted' };
        // An unverified holder could be a squatter; joining them would hand the squatter
        // a key to the real owner's account.
        if (!identity.authoritative || !existing.email_verified_at) return { ok: false, reason: 'account_not_linked' };
        user = existing;
      } else {
        if (!identity.emailVerified) return { ok: false, reason: 'email_unverified' };
        if (!signupAllowed(policy, email)) return { ok: false, reason: 'signup_closed' };
        user = await tx
          .insertInto('users')
          .values({ email, email_verified_at: new Date(), name: identity.name, locale })
          .returning(['id', 'email', 'name', 'locale', 'role', 'session_epoch', 'deleted_at'])
          .executeTakeFirstOrThrow();
        created = true;
      }
      await tx.insertInto('accounts').values({ user_id: user.id, provider: identity.provider, provider_account_id: identity.subject, last_login_at: new Date() }).execute();
    }

    if (user.deleted_at) return { ok: false, reason: 'account_deleted' };

    const role = policy.adminEmails.some((a) => a.trim().toLowerCase() === user.email.toLowerCase()) ? 'admin' : 'user';
    if (role !== user.role) await tx.updateTable('users').set({ role, updated_at: new Date() }).where('id', '=', user.id).execute();

    await sql`SELECT set_config('app.user_id', ${user.id}, true)`.execute(tx);
    const owned = await tx.selectFrom('workspaces').select('id').where('owner_id', '=', user.id).limit(1).executeTakeFirst();
    if (!owned) await createPersonalWorkspaceIn(tx, user);

    return { ok: true, userId: user.id, sessionEpoch: user.session_epoch, locale: user.locale, created };
  });
}

export interface SessionState {
  sessionEpoch: number;
  role: 'user' | 'admin';
  locale: Locale;
}

/**
 * The live state of a signed-in user, read on every session check. Null ends the
 * session: the account was deleted, or its epoch moved (sign out everywhere).
 */
export async function sessionState(userId: string, epoch: number, db: Db = getDb()): Promise<SessionState | null> {
  const row = await db.selectFrom('users').select(['session_epoch', 'role', 'locale', 'deleted_at']).where('id', '=', userId).executeTakeFirst();
  if (!row || row.deleted_at || row.session_epoch !== epoch) return null;
  return { sessionEpoch: row.session_epoch, role: row.role, locale: row.locale };
}

/** Ends every session of the user, on every device, at their next request. */
export async function endAllSessions(userId: string, db: Db = getDb()): Promise<void> {
  await db
    .updateTable('users')
    .set((eb) => ({ session_epoch: eb('session_epoch', '+', 1), updated_at: new Date() }))
    .where('id', '=', userId)
    .execute();
}

export async function setUserLocale(userId: string, locale: Locale, db: Db = getDb()): Promise<void> {
  await db.updateTable('users').set({ locale, updated_at: new Date() }).where('id', '=', userId).execute();
}
