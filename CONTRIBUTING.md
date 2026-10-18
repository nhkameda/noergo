# Contributing to noergo

Thanks for your interest. This file covers how to set up, what the project expects
from a change, and the rules that keep a public, multi-tenant codebase safe.

Security issues are **not** reported here: see [SECURITY.md](SECURITY.md).

## Set up

You need Node.js 22 (through [nvm](https://github.com/nvm-sh/nvm)), PostgreSQL 18
binaries (`brew install postgresql@18` on macOS, the `postgresql-18` package on
Debian/Ubuntu) and [gitleaks](https://github.com/gitleaks/gitleaks).

```sh
git clone https://github.com/nhkameda/noergo.git
cd noergo
nvm use                          # Node 22, from .nvmrc
npm install
git config core.hooksPath .githooks
brew install gitleaks            # or your platform's package; the hook refuses to run without it
npm run db:dev                   # local PostgreSQL 18
npm run check
```

`npm run db:dev` creates and starts a throwaway PostgreSQL 18 cluster with its data
directory outside the repository (`~/.local/share/noergo/pg18`). It listens only on
`127.0.0.1:5434`, has no Unix socket and uses `trust` authentication, so no
passwords exist anywhere. It creates the three roles, the database and the schema on
first start. Never expose it beyond loopback. `npm run db:dev -- stop` stops it and
`npm run db:dev -- psql` opens a superuser shell. `NOERGO_DEV_PGDATA` and
`NOERGO_DEV_PGPORT` override the defaults.

`npm run check` runs typecheck, lint, the tests and `npm audit` for production
dependencies. `npm run secrets` scans the git history with gitleaks.

The tests need PostgreSQL: without it `npm run check` fails. `NOERGO_SKIP_DB_TESTS=1`
runs only the pure tests, for a quick loop on code that does not touch the database;
CI ignores it. A skipped test is not a passing test: run the full suite before you
submit anything that touches `packages/core`.

`npm run e2e` runs the browser tests (Playwright, `e2e/`) against `next dev` and the
`db:dev` database. Sign-in goes through `e2e/idp.ts`, a throwaway OpenID Connect
provider on `127.0.0.1:9311` that signs in whoever asks, with no screen; it exists only
for the tests. Each test signs in a new person, so it starts from the welcome board.
The first run needs a browser: `npx playwright install --only-shell chromium`.

## Sign your commits off (DCO)

Every commit must carry a `Signed-off-by` line, added by `git commit -s`:

```
Signed-off-by: Your Name <you@example.com>
```

By signing off you certify the [Developer Certificate of Origin 1.1](https://developercertificate.org/):
that you wrote the change or otherwise have the right to submit it under this
project's license. Use your real name and an email you control. Pull requests with
unsigned-off commits are not merged. This also covers code you wrote with an AI
assistant: you are responsible for it as if you had typed it.

## Commits and pull requests

- One logical change per commit. Subject in the imperative, at most 72 characters,
  prefixed by the area: `core:`, `web:`, `mcp:`, `worker:`, `ui:`, `i18n:`,
  `docs:`, `ci:`. The body explains why, not what.
- Keep pull requests small and focused. Describe what changed, how you tested it and
  whether it touches a trust boundary.
- A change to authentication, authorization, tenancy, OAuth/MCP, billing, file
  handling, the database schema, the CSP or CI must also update
  [`docs/security/`](docs/security/README.md) (threat model and control matrix) in
  the same pull request.
- Fixes for undisclosed vulnerabilities are developed in the private fork of the
  security advisory, not in a public branch. Do not describe the exploit in a public
  commit before the advisory is published.

## Tests

- Every bug fix comes with a test that fails without the fix.
- Every security fix **must** include a regression test that fails without the patch
  and passes with it, plus a check for variants of the same bug elsewhere.
- Anything that reads or writes content needs a cross-workspace test: an id from
  another workspace must answer `not_found` and change nothing (see
  `packages/core/test/domain.test.ts`).
- Tests use synthetic data only.

## Internationalization

noergo ships in **pt-BR, en and zh-CN**. No user-facing string is hard-coded in a
component, an API response or an MCP tool result shown to people: add a key to
`packages/i18n` with all three translations. The domain layer returns stable error
codes (`not_found`, `version_conflict`, `plan_required`, …), never prose meant for
display; the UI translates the code. Seed content exists per locale
(`packages/core/src/seed.ts`).

## The database rule

- Only `packages/core` talks to PostgreSQL. ESLint rejects imports of `pg` and
  `kysely` anywhere else; apps import `@noergo/core`.
- Every query on a content table runs inside `withWorkspace()`, which sets the
  transaction's workspace for row-level security, **and** also filters by
  `workspace_id` itself. Two walls, on purpose: do not remove either.
- A new table with a `workspace_id` gets `ENABLE` and `FORCE ROW LEVEL SECURITY`
  and the `workspace_isolation` policy in the same migration, plus composite foreign
  keys `(id, workspace_id)` to its parents.
- An id that belongs to another workspace is answered with `not_found`, never with
  `forbidden`, so ids cannot be probed.
- The `noergo_jobs` role bypasses row-level security and is used by `apps/worker`
  only. Web and MCP use `noergo_app`.

## Migrations

Migrations are plain SQL files in `packages/core/migrations/`, named
`NNNN_description.sql` and applied in order, one transaction each, by the
`noergo_migrator` role.

- They are **append-only**. Never edit a migration that has been applied anywhere;
  write a new one. The runner (`packages/core/src/db/migrate.ts`) stores a SHA-256
  checksum of each applied file and stops if one changed.
- Prefer expand-then-contract changes, so the previous image keeps working against
  the new schema and a rollback stays possible.

## Keep production out of the repository

This repository is public, and anything committed stays in its history. Never commit:

- secrets of any kind: keys, tokens, passwords, connection strings with credentials,
  `.env` files. Configuration reads from the environment; a `.env.example` holds
  placeholders only;
- IP addresses, hostnames of real servers (other than the public `noergo.com`),
  ports of real deployments, account or project ids of providers;
- names of secrets or secret-manager items used by a real deployment;
- real user data, real email addresses, or screenshots that contain them.

The pre-commit hook (`.githooks/pre-commit`, configured by `.gitleaks.toml`) runs
gitleaks on every commit; CI runs it again, and the GitHub repository uses push
protection and secret scanning. They catch mistakes; they are not a reason to be
careless. If you commit a secret by accident, tell the maintainer
privately: rewriting history is not enough, the secret has to be rotated.

## Dependencies

A new dependency needs a reason in the pull request. Check that the package is the
one you mean (no look-alike names), who maintains it, its age and activity, and
whether it runs install scripts (`allowScripts` in `package.json` lists the allowed
ones). Commit the updated `package-lock.json`. Prefer the platform or an existing
dependency when the gain is small.

## License

noergo is licensed under the [GNU Affero General Public License v3.0 only](LICENSE)
(`AGPL-3.0-only`). Contributions are accepted under the same license; there is no
CLA, the DCO sign-off is all we ask. Remember the AGPL's network clause: if you run a
modified version as a service for others, you must offer those users its source.

The name and logo are not covered by the AGPL: see
[brand/TRADEMARK.md](brand/TRADEMARK.md).
