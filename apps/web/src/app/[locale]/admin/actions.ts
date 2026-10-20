'use server';

import {
  adminRevokeConnection,
  adminRevokeToken,
  endAccountSessions,
  isDomainError,
  setAccountBlocked,
  setAgentsAllowed,
  settingsPatchSchema,
  updateSettings,
} from '@noergo/core';
import { currentAdmin } from '@/lib/session';

export type AdminResult = { ok: true } | { ok: false; code: string };

/**
 * Every action asks for the administrator again (the page that rendered the button is
 * no proof), and anyone else hears not_found, as from the pages.
 */
async function run(where: string, fn: (adminId: string) => Promise<void>): Promise<AdminResult> {
  const adminId = await currentAdmin();
  if (!adminId) return { ok: false, code: 'not_found' };
  try {
    await fn(adminId);
    return { ok: true };
  } catch (e) {
    if (isDomainError(e)) return { ok: false, code: e.code };
    console.error(`[admin] ${where}: ${(e as Error)?.stack ?? String(e)}`);
    return { ok: false, code: 'internal' };
  }
}

const isId = (v: unknown): v is string => typeof v === 'string' && v.length <= 64;

export async function setBlockedAction(userId: string, blocked: boolean): Promise<AdminResult> {
  if (!isId(userId) || typeof blocked !== 'boolean') return { ok: false, code: 'invalid' };
  return run('block', (adminId) => setAccountBlocked(adminId, userId, blocked));
}

export async function setAgentsAction(userId: string, allowed: boolean): Promise<AdminResult> {
  if (!isId(userId) || typeof allowed !== 'boolean') return { ok: false, code: 'invalid' };
  return run('agents', (adminId) => setAgentsAllowed(adminId, userId, allowed));
}

export async function endSessionsAction(userId: string): Promise<AdminResult> {
  if (!isId(userId)) return { ok: false, code: 'invalid' };
  return run('end sessions', (adminId) => endAccountSessions(adminId, userId));
}

export async function revokeConnectionAction(userId: string, connectionId: string): Promise<AdminResult> {
  if (!isId(userId) || !isId(connectionId)) return { ok: false, code: 'invalid' };
  return run('revoke connection', (adminId) => adminRevokeConnection(adminId, userId, connectionId));
}

export async function revokeTokenAction(userId: string, tokenId: string): Promise<AdminResult> {
  if (!isId(userId) || !isId(tokenId)) return { ok: false, code: 'invalid' };
  return run('revoke token', (adminId) => adminRevokeToken(adminId, userId, tokenId));
}

export async function saveSettingsAction(patch: unknown): Promise<AdminResult> {
  const parsed = settingsPatchSchema.safeParse(patch);
  if (!parsed.success) return { ok: false, code: 'invalid' };
  return run('settings', (adminId) => updateSettings(adminId, parsed.data));
}
