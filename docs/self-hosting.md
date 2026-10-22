# Self-hosting

noergo is AGPL-3.0: you can run it on your own server, for yourself or your organisation.
A self-hosted instance has every feature, including AI agents over MCP: noergo has no
plans and nothing to pay.

> **Status:** pre-release. The image builds from `main` (`ghcr.io/nhkameda/noergo:edge`);
> pin a version tag once releases exist.

## Requirements

- A Linux server with Docker and the Compose plugin (amd64 or arm64), 1 GB RAM minimum.
- A domain pointing at it, with HTTPS (the bundled Caddy gets a certificate for you).
- At least one sign-in provider: Google, Microsoft, or any OpenID Connect server.

## Install

```sh
git clone https://github.com/nhkameda/noergo.git && cd noergo
cp docker/.env.example docker/.env
# fill in docker/.env (every secret: openssl rand -hex 32)
docker compose -f docker/compose.yml --env-file docker/.env --profile caddy up -d
```

The first start creates the database (`packages/core/sql/bootstrap.sql`), the `migrate`
service applies the schema, then `web`, `mcp` and `worker` start. Open `NOERGO_PUBLIC_URL`
and sign in with the address in `NOERGO_ADMIN_EMAILS`. By default nobody else can create an
account. The sign-in providers and how accounts are matched are described in
[configuration.md](configuration.md#sign-in-providers).

### Administration

An administrator finds **Administration** in the account menu (`/<language>/admin`):

- **Accounts**: search by e-mail or name; see how each one signs in, its agents and tokens;
  block and unblock it, sign it out everywhere, enable agents for it, revoke a connection.
  A blocked account cannot sign in, and its sessions, agents and tokens stop working until
  it is unblocked. Blocking never deletes anything.
- **Settings**: who may create an account (anyone, or a list of e-mails and `@domains`),
  who may connect agents, and how much each account may store. `SIGNUP`,
  `SIGNUP_ALLOWLIST` and `MCP_ACCESS` are only the starting values; see
  [configuration.md](configuration.md).

Every action there is written to the `audit_log` table, with who did it and when.

### With your own reverse proxy

Leave out `--profile caddy` and route, on one host name:

- `/mcp`, `/oauth/*` except `/oauth/interaction/*`, `/.well-known/oauth-*` and
  `/.well-known/openid-configuration` → `127.0.0.1:3042` (mcp);
- everything else → `127.0.0.1:3041` (web), **without response buffering** (the live
  stream is Server-Sent Events) and with a read timeout of at least one hour.

`docker/Caddyfile` is the reference. Redirect `www.` to the bare host at the proxy.

## Updates

A new version is a new commit on `main`: the `edge` image follows it a few minutes later.
`NOERGO_VERSION` in `docker/.env` must be `edge` until releases exist. An `.env` copied
before 22 October 2026 says `latest`, a tag that was never published (the pull fails with
`manifest unknown`); change it to `edge`.

From the directory you cloned, after a [backup](#backups):

```sh
grep NOERGO_VERSION docker/.env    # edge
git pull
docker compose -f docker/compose.yml --env-file docker/.env pull
docker compose -f docker/compose.yml --env-file docker/.env up -d
```

Add `--profile caddy` to the last line if you installed with it. `up -d` recreates web, mcp
and worker on the new image; before they start, the `migrate` service applies any new
migration. Migrations are append-only, and the runner refuses to start if a migration file
it already applied has changed. If `git pull` stops on a file you edited, keep your
changes in `docker/.env`, not in `docker/compose.yml`.

To see which commit is running:

```sh
docker compose -f docker/compose.yml --env-file docker/.env ps
docker inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' \
  $(docker compose -f docker/compose.yml --env-file docker/.env ps -q web)
```

Every build is also tagged `sha-<full commit>`. Setting `NOERGO_VERSION` to an earlier one
goes back to that image, but migrations do not run backwards: to return to an older
schema, restore the backup.

## Backups

Everything lives in the `pgdata` volume (and `files`, with `STORAGE=local`). At minimum:

```sh
docker compose -f docker/compose.yml exec -T postgres pg_dump -U postgres -Fc noergo > noergo-$(date +%F).dump
```

Keep copies off the server and test a restore now and then (`pg_restore` into a scratch
database and compare row counts). For point-in-time recovery, use WAL archiving
(pgBackRest or WAL-G).

## Connecting agents

Once it runs, your instance's MCP endpoint is `https://<your domain>/mcp`, and
`https://<your domain>/agents` explains how to add it to each client. ChatGPT, Claude,
Grok, Claude Code and Cursor sign in with OAuth on their own: the person approves on
noergo's consent page and can disconnect them on the Agents page. For scripts and other
clients, create a personal token there. On the administration page, "only enabled
accounts" limits agents to the accounts you enable; see [mcp-clients.md](mcp-clients.md) for what each client supports.

The reverse proxy must keep `/internal/*` away from the internet: web reaches mcp there
directly. Its requests are signed, but nothing outside should reach that path.
