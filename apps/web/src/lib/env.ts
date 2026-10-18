import type { SignInPolicy } from '@noergo/core';

/** The public URL of this instance, without a trailing slash. */
export const PUBLIC_URL = (process.env.NOERGO_PUBLIC_URL ?? 'http://localhost:3041').replace(/\/+$/, '');
export const PUBLIC_ORIGIN = new URL(PUBLIC_URL).origin;

const list = (v: string | undefined): string[] =>
  (v ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

/**
 * Who may create an account. Unset means closed except for the administrators: a
 * self-hosted instance put on the internet must not become a free notes service for
 * anyone who finds it. noergo.com sets SIGNUP=open.
 */
export function signInPolicy(): SignInPolicy {
  const mode = process.env.SIGNUP ?? 'allowlist';
  if (mode !== 'open' && mode !== 'allowlist') throw new Error(`SIGNUP must be "open" or "allowlist", not "${mode}"`);
  const adminEmails = list(process.env.NOERGO_ADMIN_EMAILS);
  return { signup: mode, allowlist: [...list(process.env.SIGNUP_ALLOWLIST), ...adminEmails], adminEmails };
}
