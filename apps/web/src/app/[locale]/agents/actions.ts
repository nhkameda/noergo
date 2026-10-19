'use server';

import { agentAccessAllowed, createApiToken, isDomainError, revokeApiToken, revokeConnection, type TokenDto } from '@noergo/core';
import { auth } from '@/auth';
import { MCP_ACCESS } from '@/lib/mcp-bridge';

export type ActionResult<T = object> = ({ ok: true } & T) | { ok: false; code: string };

async function signedIn(): Promise<string | null> {
  return (await auth())?.user?.id ?? null;
}

function failed(e: unknown, where: string): { ok: false; code: string } {
  if (isDomainError(e)) return { ok: false, code: e.code };
  console.error(`[agents] ${where}: ${(e as Error)?.stack ?? String(e)}`);
  return { ok: false, code: 'internal' };
}

/** A new personal token; the only time its value leaves the server. */
export async function createTokenAction(name: string, readOnly: boolean): Promise<ActionResult<{ token: string; info: TokenDto }>> {
  const userId = await signedIn();
  if (!userId) return { ok: false, code: 'unauthenticated' };
  if (typeof name !== 'string' || typeof readOnly !== 'boolean') return { ok: false, code: 'invalid' };
  try {
    if (!(await agentAccessAllowed(userId, MCP_ACCESS))) return { ok: false, code: 'plan_required' };
    const { token, info } = await createApiToken(userId, { name, readOnly });
    return { ok: true, token, info };
  } catch (e) {
    return failed(e, 'create token');
  }
}

export async function revokeTokenAction(id: string): Promise<ActionResult> {
  const userId = await signedIn();
  if (!userId) return { ok: false, code: 'unauthenticated' };
  try {
    await revokeApiToken(userId, String(id));
    return { ok: true };
  } catch (e) {
    return failed(e, 'revoke token');
  }
}

export async function disconnectAction(id: string): Promise<ActionResult> {
  const userId = await signedIn();
  if (!userId) return { ok: false, code: 'unauthenticated' };
  try {
    await revokeConnection(userId, String(id));
    return { ok: true };
  } catch (e) {
    return failed(e, 'disconnect');
  }
}
