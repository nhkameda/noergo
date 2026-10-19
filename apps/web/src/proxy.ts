import { isLocale, negotiate } from '@noergo/i18n';
import { NextRequest, NextResponse } from 'next/server';
import createMiddleware from 'next-intl/middleware';
import { LOCALE_COOKIE, LOCALE_OF_PREFIX, PREFIX, routing } from './i18n/routing';
import { PUBLIC_ORIGIN } from './lib/env';
import { mutationOriginAllowed } from './lib/request-origin';

const intl = createMiddleware(routing);

/** Where attachments are served from (a separate, cookieless origin). */
const ATTACHMENTS_ORIGIN = process.env.NOERGO_ATTACHMENTS_ORIGIN ?? '';

/**
 * Per-request Content-Security-Policy with a nonce: no inline script runs unless Next.js
 * marked it. Images only from this site and the attachments origin, so markdown written
 * by an agent cannot leak data through an external image URL.
 */
function contentSecurityPolicy(nonce: string): string {
  const dev = process.env.NODE_ENV === 'development';
  const files = ATTACHMENTS_ORIGIN ? ` ${ATTACHMENTS_ORIGIN}` : '';
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    `style-src 'self' 'nonce-${nonce}'`,
    // The maps position nodes with style attributes; attributes cannot carry a nonce.
    "style-src-attr 'unsafe-inline'",
    `img-src 'self' blob: data:${files}`,
    `media-src 'self'${files}`,
    "font-src 'self'",
    `connect-src 'self'${files}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(dev ? [] : ['upgrade-insecure-requests']),
  ].join('; ');
}

/** Only a real page load counts as choosing a language (see src/i18n/routing.ts). */
function isDocumentNavigation(h: Headers): boolean {
  if (/prefetch|prerender/i.test(`${h.get('sec-purpose') ?? ''} ${h.get('purpose') ?? ''}`)) return false;
  const dest = h.get('sec-fetch-dest');
  const mode = h.get('sec-fetch-mode');
  if (dest || mode) return dest === 'document' || mode === 'navigate';
  return /\btext\/html\b/i.test(h.get('accept') ?? '');
}

export default function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (pathname.startsWith('/api/')) {
    if (!mutationOriginAllowed(request, PUBLIC_ORIGIN)) {
      return NextResponse.json({ error: { code: 'forbidden', message: 'cross-origin request refused' } }, { status: 403 });
    }
    return NextResponse.next();
  }

  const chosen = LOCALE_OF_PREFIX[pathname.split('/')[1] ?? ''];
  const interaction = pathname.startsWith('/oauth/interaction/');
  // The agents' endpoints belong to mcp. The reverse proxy sends them there; in development
  // next.config.ts rewrites them (NOERGO_MCP_PROXY). They are never pages to localise.
  if (pathname === '/mcp' || (pathname.startsWith('/oauth/') && !interaction)) return NextResponse.next();

  // A page without a language prefix (/, or /signin from Auth.js) goes to the person's
  // language: the saved choice, else the browser's.
  if (!chosen && !interaction) {
    const saved = request.cookies.get(LOCALE_COOKIE)?.value;
    const locale = isLocale(saved) ? saved : negotiate(request.headers.get('accept-language'));
    const url = new URL(`/${PREFIX[locale]}${pathname === '/' ? '' : pathname}${search}`, request.url);
    const res = NextResponse.redirect(url, 307);
    res.headers.set('Vary', 'Accept-Language, Cookie');
    res.headers.set('Cache-Control', 'private, no-store');
    return res;
  }

  const nonce = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('base64');
  const csp = contentSecurityPolicy(nonce);
  const headers = new Headers(request.headers);
  headers.set('x-nonce', nonce);
  headers.set('content-security-policy', csp);

  // The OAuth consent page sits at the cookie path oidc-provider uses; it is not localised by URL.
  const res = interaction
    ? NextResponse.next({ request: { headers } })
    : intl(new NextRequest(request, { headers }));
  res.headers.set('Content-Security-Policy', csp);

  if (chosen && isDocumentNavigation(request.headers) && request.cookies.get(LOCALE_COOKIE)?.value !== chosen) {
    res.cookies.set(LOCALE_COOKIE, chosen, { path: '/', sameSite: 'lax', httpOnly: true, secure: request.nextUrl.protocol === 'https:', maxAge: 60 * 60 * 24 * 365 });
  }
  return res;
}

export const config = {
  // Pages, plus /api for the origin check. Next.js assets, files with an extension and
  // the health probe go straight through.
  matcher: ['/api/:path*', '/((?!api|_next|healthz|.*\\..*).*)'],
};
