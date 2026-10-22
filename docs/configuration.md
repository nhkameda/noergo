# Configuration

All configuration is environment variables. `docker/.env.example` lists them with comments.

Three of them are only the **starting value** of a setting the administrators can change on
the administration page (account menu → Administration, at `/<language>/admin/settings`):
`SIGNUP`, `SIGNUP_ALLOWLIST` and `MCP_ACCESS`. Once a setting is saved there, the saved value
wins; choosing "inherit" hands it back to the environment. The page shows where each value
comes from. The storage quota per account is set only there (250 MB until changed).

Who the administrators are is never set on that page: it comes from `NOERGO_ADMIN_EMAILS`
alone, so nobody can promote themselves or lock everyone out from the screen.

| Variable | Default | |
|---|---|---|
| `NOERGO_PUBLIC_URL` | — | Public URL of the instance, `https://…`, no trailing slash. |
| `NOERGO_SOURCE_URL` | `https://github.com/nhkameda/noergo` | Where the app's "Source code" link points. The AGPL requires it to lead to the code you actually run: set it to your fork if you changed anything. |
| `DATABASE_URL` | — | Runtime role (`noergo_app`, subject to row-level security). Set by the compose file. |
| `DATABASE_JOBS_URL` | — | Worker only (`noergo_jobs`). |
| `DATABASE_MIGRATOR_URL` | — | `migrate` only (`noergo_migrator`, owner of the schema). |
| `DATABASE_POOL_MAX` | `10` | Connections per process. |
| `AUTH_SECRET` | — | Session encryption key. |
| `SIGNUP` | `allowlist` | Starting value. `open`: anyone can create an account. `allowlist`: only the addresses below and the administrators. |
| `SIGNUP_ALLOWLIST` | — | Starting value. Comma-separated e-mails or `@domain` entries allowed to sign up when sign-up is by list. |
| `NOERGO_ADMIN_EMAILS` | — | Comma-separated e-mails of the administrators. Checked at every sign-in and on every administration page and action: an address removed from the list loses the administration at once. |
| `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` | — | Google sign-in. |
| `AUTH_MICROSOFT_ENTRA_ID_ID`, `AUTH_MICROSOFT_ENTRA_ID_SECRET` | — | Microsoft sign-in. |
| `AUTH_MICROSOFT_ENTRA_ID_TENANT` | `common` | `common` takes personal and work accounts; a tenant id restricts sign-in to that organisation. |
| `AUTH_OIDC_ISSUER`, `AUTH_OIDC_ID`, `AUTH_OIDC_SECRET` | — | Any OpenID Connect provider (Authentik, Keycloak…). |
| `AUTH_OIDC_NAME` | `SSO` | Label of its button. |
| `STORAGE` | `local` | `local` (the `files` volume) or `s3`. |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | — | Any S3-compatible storage. |
| `NOERGO_ATTACHMENTS_ORIGIN` | — | Origin files are served from; allowed in the Content-Security-Policy. |
| `MCP_HOST`, `MCP_PORT` | `0.0.0.0`, `3042` | Where mcp listens (in the image). |
| `MCP_ACCESS` | `all` | Starting value. Who may connect agents. `all`: every account. `granted`: administrators and the accounts an administrator enabled on the administration page. |
| `MCP_CIMD_HOSTS` | `chatgpt.com,claude.ai,claude.com` | Hosts whose client metadata documents mcp fetches, so those clients need no registration. Any other client registers dynamically. `none` turns fetching off. |
| `NOERGO_MCP_INTERNAL_URL` | `http://127.0.0.1:3042` | How web reaches mcp to answer the consent page. Never routed by the reverse proxy. `docker/compose.yml` sets `http://mcp:3042`. |
| `NOERGO_VERSION` | `edge` | In `docker/compose.yml`, the image tag ([updates](self-hosting.md#updates)). Given to mcp outside Compose, the version it reports to agents (default `0.1.0`). |
| `HOSTNAME`, `PORT` | `0.0.0.0`, `3041` | Where web listens (in the image). To listen on loopback only, use `localhost` with `NODE_OPTIONS=--dns-result-order=ipv4first`, never `127.0.0.1`: Next.js then turns every language rewrite into a request to itself, which fails behind a TLS proxy. |
| `NOERGO_BIND`, `NOERGO_WEB_PORT`, `NOERGO_MCP_PORT` | `127.0.0.1`, `3041`, `3042` | Only for `docker/compose.yml`: the host interface and ports web and mcp are published on. |

Providers whose variables are empty are simply not offered on the sign-in page.

## Sign-in providers

Register `<NOERGO_PUBLIC_URL>/api/auth/callback/<id>` as the redirect URI, where `<id>` is
`google`, `microsoft-entra-id` or `oidc`. noergo asks only for `openid email profile`.

How accounts are matched matters more than it looks, because an e-mail claim is not always
proof of owning the mailbox:

- A provider identity, once linked, always signs in to the same account.
- A new identity joins an existing account with the same e-mail **only through Google**, and
  only for Gmail and Google Workspace addresses: there Google owns the mailbox. Microsoft and
  generic OIDC identities never join an existing account; the person is told to use the
  method they used first.
- A new account needs an e-mail the provider verified.
  - **Google:** `email_verified`.
  - **Generic OIDC:** `email_verified` from the userinfo endpoint.
  - **Microsoft:** personal accounts are verified. In work and school tenants, the address is
    whatever the tenant's administrator typed, so it counts only with the `xms_edov` claim.
    In the Entra app registration, go to **Token configuration → Add optional claim → ID →
    `xms_edov`**. Without it, work accounts cannot sign up.
