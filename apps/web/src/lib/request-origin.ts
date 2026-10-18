/**
 * Cross-site request forgery guard for the JSON API: every mutation under /api must come
 * from a page of this site. Sessions are cookies, so without this any other site could
 * make a signed-in browser write to its notes.
 *
 * A request without Origin passes only with Sec-Fetch-Site: same-origin; "null" (sandboxed
 * frames, some redirects) never passes. Exempt paths authenticate otherwise: provider
 * callbacks carry their own state, Stripe signs its webhooks, internal calls carry an HMAC.
 */
const EXEMPT = /^\/api\/(?:auth\/callback\/|webhooks\/|internal\/)/;

export function mutationOriginAllowed(req: Request, publicOrigin: string): boolean {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return true;
  const path = new URL(req.url).pathname;
  if (!path.startsWith('/api/') || EXEMPT.test(path)) return true;
  const origin = req.headers.get('origin');
  if (!origin) return req.headers.get('sec-fetch-site') === 'same-origin';
  return origin === publicOrigin;
}
