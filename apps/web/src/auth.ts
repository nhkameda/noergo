import {
  adminEmails,
  envSettings,
  googleIdentity,
  instanceSettings,
  microsoftIdentity,
  oidcIdentity,
  redactText,
  sessionState,
  signInFederated,
  type FederatedIdentity,
  type SignInPolicy,
  type SignInRefusal,
} from '@noergo/core';
import { isLocale, negotiate, type Locale } from '@noergo/i18n';
import NextAuth, { type NextAuthConfig } from 'next-auth';
import type { Provider } from 'next-auth/providers';
import Google from 'next-auth/providers/google';
import MicrosoftEntraID from 'next-auth/providers/microsoft-entra-id';
import type { NextRequest } from 'next/server';
import { LOCALE_COOKIE } from '@/i18n/routing';
import { PUBLIC_URL } from '@/lib/env';

/**
 * Auth.js v5, used for the OAuth dance only. Accounts, links and the signup policy live
 * in @noergo/core (identity.ts), so Auth.js keeps no tables and stores no provider
 * token; replacing it means feeding the same ID-token claims to signInFederated.
 *
 * The session is a JWT carrying only the user id and its session epoch. Every read
 * checks both against the database, so deleting the account or "sign out everywhere"
 * ends sessions at the next request.
 */

// Callback URLs are built from the public URL, never from the Host header of the request.
process.env.AUTH_URL ??= `${PUBLIC_URL}/api/auth`;

// A typo in SIGNUP or MCP_ACCESS stops the server instead of opening the instance.
envSettings();

/**
 * Who may create an account: what an administrator saved, else SIGNUP and SIGNUP_ALLOWLIST,
 * else closed except for the administrators (packages/core settings.ts).
 */
async function signInPolicy(): Promise<SignInPolicy> {
  const s = await instanceSettings();
  return { signup: s.signup, allowlist: s.allowlist, adminEmails: adminEmails() };
}

declare module 'next-auth' {
  interface User {
    epoch?: number;
  }
  interface Session {
    /** epoch: the session epoch, for long-lived streams that re-check it themselves. */
    user: { id: string; role: 'user' | 'admin'; locale: Locale; epoch: number };
  }
}

declare module '@auth/core/jwt' {
  interface JWT {
    uid?: string;
    epoch?: number;
    role?: 'user' | 'admin';
    locale?: Locale;
  }
}

export interface SignInOption {
  id: string;
  name: string;
}

const env = process.env;

/** Providers register only when fully configured: a half-configured one would draw a button that leads to an error. */
function providers(): Provider[] {
  const list: Provider[] = [];
  if (env.AUTH_GOOGLE_ID && env.AUTH_GOOGLE_SECRET) {
    list.push(Google({ clientId: env.AUTH_GOOGLE_ID, clientSecret: env.AUTH_GOOGLE_SECRET, authorization: { params: { prompt: 'select_account' } } }));
  }
  if (env.AUTH_MICROSOFT_ENTRA_ID_ID && env.AUTH_MICROSOFT_ENTRA_ID_SECRET) {
    list.push(
      MicrosoftEntraID({
        clientId: env.AUTH_MICROSOFT_ENTRA_ID_ID,
        clientSecret: env.AUTH_MICROSOFT_ENTRA_ID_SECRET,
        // "common" takes work, school and personal accounts (outlook.com, hotmail.com).
        issuer: `https://login.microsoftonline.com/${env.AUTH_MICROSOFT_ENTRA_ID_TENANT || 'common'}/v2.0`,
        // No User.Read: the default profile calls Microsoft Graph for a photo noergo never shows.
        authorization: { params: { scope: 'openid profile email' } },
        profile: (p) => ({ id: p.sub, name: p.name, email: p.email ?? p.preferred_username, image: null }),
      }),
    );
  }
  if (env.AUTH_OIDC_ISSUER && env.AUTH_OIDC_ID && env.AUTH_OIDC_SECRET) {
    list.push({
      id: 'oidc',
      name: env.AUTH_OIDC_NAME || 'SSO',
      type: 'oidc',
      issuer: env.AUTH_OIDC_ISSUER,
      clientId: env.AUTH_OIDC_ID,
      clientSecret: env.AUTH_OIDC_SECRET,
      authorization: { params: { scope: 'openid email profile' } },
      checks: ['pkce', 'state'],
      // Read the profile from userinfo: several providers keep email out of the ID token.
      idToken: false,
    });
  }
  return list;
}

export function signInOptions(): SignInOption[] {
  return providers().map((p) => {
    const o = typeof p === 'function' ? p() : p;
    return { id: o.id, name: o.name };
  });
}

function identityOf(provider: string, claims: Record<string, unknown>): FederatedIdentity | null {
  if (provider === 'google') return googleIdentity(claims);
  if (provider === 'microsoft-entra-id') return microsoftIdentity(claims);
  if (provider === 'oidc') return oidcIdentity(claims);
  return null;
}

function localeOf(req: NextRequest | undefined): Locale {
  const saved = req?.cookies.get(LOCALE_COOKIE)?.value;
  return isLocale(saved) ? saved : negotiate(req?.headers.get('accept-language') ?? null);
}

/** Back to our sign-in page with a reason it can explain, never to Auth.js's own error page. */
const refused = (reason: SignInRefusal | 'unknown') => `${PUBLIC_URL}/signin?error=${reason}`;

/**
 * Auth.js outcomes that are behaviour, not defects (a cancelled consent, a probe of an
 * unknown action). Matched on the documentation slug in the message, because error
 * class names are minified in production builds.
 */
const EXPECTED = ['#accessdenied', '#oauthcallbackerror', '#unknownaction', '#invalidprovider', '#oauthaccountnotlinked'];

function config(req: NextRequest | undefined): NextAuthConfig {
  return {
    providers: providers(),
    session: { strategy: 'jwt' },
    pages: { signIn: '/signin', error: '/signin' },
    logger: {
      error(error) {
        const cause = (error as { cause?: { err?: Error } }).cause?.err;
        const line = redactText(`[auth] ${error.name}: ${error.message}${cause ? ` <- ${cause.message}` : ''}`);
        if (EXPECTED.some((slug) => error.message.toLowerCase().includes(slug))) console.info(line);
        else console.error(line);
      },
      warn(code) {
        console.warn(`[auth] warning ${code}`);
      },
      debug() {},
    },
    callbacks: {
      async signIn({ user, account, profile }) {
        if (!account || !profile) return false;
        const identity = identityOf(account.provider, profile as Record<string, unknown>);
        if (!identity) return refused('unknown');
        const result = await signInFederated(identity, await signInPolicy(), localeOf(req));
        if (!result.ok) {
          console.info(`[auth] sign-in refused: ${result.reason} (${identity.provider})`);
          return refused(result.reason);
        }
        // Auth.js passes this same object to the jwt callback below.
        user.id = result.userId;
        user.epoch = result.sessionEpoch;
        return true;
      },
      async jwt({ token, user }) {
        if (user?.id && user.epoch !== undefined) {
          // Only what is needed: no name, e-mail or picture travels in the cookie.
          return { sub: user.id, uid: user.id, epoch: user.epoch };
        }
        if (!token.uid || token.epoch === undefined) return null;
        const state = await sessionState(token.uid, token.epoch);
        if (!state) return null;
        return { ...token, role: state.role, locale: state.locale };
      },
      session({ session, token }) {
        return { ...session, user: { id: token.uid!, role: token.role ?? 'user', locale: token.locale ?? 'en', epoch: token.epoch ?? 0 } } as typeof session;
      },
    },
  };
}

export const { handlers, auth, signIn, signOut } = NextAuth(async (req) => config(req));
