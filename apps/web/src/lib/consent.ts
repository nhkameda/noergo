import { agentAccessAllowed } from '@noergo/core';
import { isLocale, negotiate, type Locale } from '@noergo/i18n';
import { cookies, headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { LOCALE_COOKIE } from '@/i18n/routing';
import { apiError, apiUser } from './api';
import { readBoundedText } from './bounded-body';
import { PUBLIC_ORIGIN, PUBLIC_URL } from './env';
import { INTERACTION_UID, interactionBridge, interactionCookies } from './mcp-bridge';

/** The consent page has no language in its URL (it sits at oidc-provider's cookie path). */
export async function consentLocale(): Promise<Locale> {
  const saved = (await cookies()).get(LOCALE_COOKIE)?.value;
  return isLocale(saved) ? saved : negotiate((await headers()).get('accept-language'));
}

/**
 * POST /oauth/interaction/:uid/(confirm|abort), from the consent page. These sit under the
 * interaction cookie's path, outside /api, so the origin check of src/proxy.ts does not
 * cover them: they make it themselves, strictly.
 */
export async function answerInteraction(req: Request, uid: string, action: 'confirm' | 'abort'): Promise<Response> {
  if (req.headers.get('origin') !== PUBLIC_ORIGIN) return apiError('forbidden', 'cross-origin request refused');
  if (!INTERACTION_UID.test(uid)) return apiError('not_found', 'not found');
  const user = await apiUser();
  if (!user) return apiError('unauthenticated', 'sign in first');

  let body = '';
  if (action === 'confirm') {
    let readOnly: boolean;
    try {
      readOnly = (JSON.parse((await readBoundedText(req, 1024)) ?? '{}') as { readOnly?: unknown }).readOnly === true;
    } catch {
      return apiError('invalid', 'the body must be JSON');
    }
    if (!(await agentAccessAllowed(user.id))) return apiError('agents_not_enabled', 'agents are not enabled for this account');
    body = JSON.stringify({ userId: user.id, readOnly });
  }

  const { status, data } = await interactionBridge<{ location?: string }>('POST', `/internal/interaction/${uid}/${action}`, interactionCookies(req.headers.get('cookie')), body);
  if (status === 410) return NextResponse.json({ error: { code: 'interaction_expired', message: 'this request expired' } }, { status: 410, headers: { 'cache-control': 'no-store' } });
  const location = data?.location;
  // The answer goes back through our own authorization endpoint, never straight elsewhere.
  if (status !== 200 || typeof location !== 'string' || !location.startsWith(`${PUBLIC_URL}/oauth/authorize/`)) {
    console.error(`[consent] ${action} ${uid}: mcp answered ${status}`);
    return apiError('internal', 'the authorization server did not answer');
  }
  return NextResponse.json({ location }, { headers: { 'cache-control': 'no-store' } });
}
