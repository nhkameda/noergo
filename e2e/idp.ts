/**
 * A throwaway OpenID Connect provider for the end-to-end tests: it signs in whoever asks,
 * with no screen. The person is chosen by the `e2e_user` cookie on the provider's own
 * origin (tests set it on the browser context), so one run can sign in several people.
 *
 * It listens on loopback only and is never part of a build.
 */
import { Events, OAuth2Server } from 'oauth2-mock-server';

const port = Number(process.env.E2E_IDP_PORT ?? 9311);
const server = new OAuth2Server();
await server.issuer.keys.generate('RS256');

const byCode = new Map<string, string>();
const userOf = (cookie: string | undefined) => /(?:^|;\s*)e2e_user=([a-z0-9-]{1,40})/.exec(cookie ?? '')?.[1] ?? 'ana';
const claims = (user: string) => ({ sub: `e2e-${user}`, email: `${user}@noergo.test`, email_verified: true, name: user });

server.service.on(Events.BeforeAuthorizeRedirect, ({ url }, req) => {
  const code = url.searchParams.get('code');
  if (code) byCode.set(code, userOf(req.headers.cookie));
});

server.service.on(Events.BeforeTokenSigning, (token, req) => {
  const code = typeof req.body.code === 'string' ? req.body.code : '';
  Object.assign(token.payload, claims(byCode.get(code) ?? 'ana'));
});

server.service.on(Events.BeforeUserinfo, (res, req) => {
  const jwt = (req.headers.authorization ?? '').replace(/^Bearer /, '');
  const payload = JSON.parse(Buffer.from(jwt.split('.')[1] ?? '', 'base64url').toString() || '{}') as { sub?: string };
  res.body = claims((payload.sub ?? 'e2e-ana').replace(/^e2e-/, ''));
});

await server.start(port, '127.0.0.1');
// It names itself localhost; the issuer must be the exact URL the app was given.
server.issuer.url = `http://127.0.0.1:${port}`;
console.info(`e2e identity provider on ${server.issuer.url}`);
