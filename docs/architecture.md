# Architecture

noergo is three Node.js processes over one PostgreSQL database, shipped as one Docker image.

```
browser ──HTTPS──► reverse proxy ──┬─► web     Next.js: pages, /api/ops, /api/stream (SSE),
                                   │           sign-in, billing, OAuth consent page
AI agent ─HTTPS──►                 └─► mcp     MCP (Streamable HTTP) + OAuth 2.1 server
                                       worker  maintenance and attachment processing
                    all three ──► PostgreSQL 18 (row-level security)   ──► S3 / local files
```

| Path | Goes to |
|---|---|
| `/mcp`, `/oauth/*` (except `/oauth/interaction/*`), `/.well-known/oauth-*`, `/.well-known/openid-configuration` | mcp |
| everything else | web |

## Packages

| Package | Role |
|---|---|
| `packages/core` | The domain: schema and migrations, `withWorkspace`, operations, reads, search. The only code that talks to the database. |
| `packages/i18n` | Message catalogues: `en` (reference), `pt-BR`, `zh-CN`. |
| `packages/ui` | Design tokens, base styles, self-hosted fonts. |
| `apps/web`, `apps/mcp`, `apps/worker` | The three processes. |

## Data model

A **workspace** belongs to a user and holds everything: **boards**, their **lanes**
("columns" in the interface) and **notes**. **Links** connect any two of them (a note, a
column hub, a board hub); `[[wikilinks]]` in a note body become links of origin `wikilink`.
**Node layouts** place a node in a visual view: the map of a column, the map of a board, or
the global graph. The same note can sit in different places in each.

Every content table carries `workspace_id` and is protected by row-level security, in
`FORCE` mode, with a policy that matches nothing when no workspace is set. The runtime role
cannot bypass it; only the worker's role can, for maintenance.

## Writes and live sync

Every change is an **operation** (`packages/core/src/ops/schema.ts`), validated with zod,
from the browser (`POST /api/ops`, batches of up to 50) or an agent (MCP tools). Each runs
in its own transaction:

1. lock the workspace row;
2. if the `opId` was seen, return the stored result (idempotent retries);
3. apply it, with per-entity versions;
4. if anything changed: `seq = seq + 1`, append to `changes`, `pg_notify`;
5. commit.

The lock serialises writers within one workspace, so `seq` has no gaps and follows commit
order. Browsers keep a live stream (`/api/stream`, Server-Sent Events, `id = seq`) and
resume with `Last-Event-ID`; when they fall too far behind, they reload a snapshot.

The browser API:

| Endpoint | |
|---|---|
| `GET /api/snapshot` | The whole workspace at one `seq`. Long note bodies travel as excerpts. |
| `POST /api/ops` | `{ ops: [{ opId, op }] }`, at most 50 ops and 2 MB. One result per op: `applied` (with `seq` and the effects), `conflict` or `rejected`. |
| `GET /api/stream?since=<seq>` | `event: change` (one change-log row, `id: <seq>`), `event: reset` (reload the snapshot), `event: signed-out`. Heartbeat every 25 s. |

Each web process holds one `LISTEN` connection, outside the pool. A notification only wakes
the streams of its workspace up; each stream then reads the change log from its own last
`seq`. A notification lost while that connection was down only delays the update: every
reconnect wakes every stream up. Mutations under `/api` must come from this site's origin
(`apps/web/src/lib/request-origin.ts`).

Conflicts: simple fields are last-writer-wins; tags are add/remove; a note body is edited
by patch against a base version, and a replacement with a stale version is refused with the
current one attached, so the client (or the agent) can merge and retry.

## Agents

Agents connect over MCP (Streamable HTTP, stateless: each POST carries its bearer and
nothing lives between calls) with OAuth 2.1 or with a personal token (`nrg_…`, stored as a
sha256). The OAuth server is oidc-provider inside mcp: dynamic client registration or a
client metadata document from a listed host, PKCE S256, one resource (`/mcp`), opaque
access tokens for an hour, rotating refresh tokens. The consent page is a web page
(`/oauth/interaction/<uid>`); web answers it through mcp's internal endpoint, signed with
an HMAC and carrying the browser's own interaction cookie, so only the browser that started
the authorization can finish it.

The tools (`apps/mcp/src/mcp/tools.ts`) read (search, fetch, boards, a thought with its
ideas and links, the thought open on the person's screen, recent activity) and write
(boards, thoughts, ideas, text, links, moves, archive). `add_notes` is the mind map's
primitive: up to 50 ideas, each linked to its parent (the thought or an earlier idea of
the same call), in one transaction. Every tool runs as operations through the same path
as the browser, with the connection's actor, so the change log, the live stream and the
undo history see agent writes like any other. Agents cannot hard-delete; a revision is kept
before each of their edits.

What is "open" comes from the browser: it reports its view and thought when they change
and every minute (`POST /api/focus`, table `user_focus`), and an agent sees it for ten
minutes. On screen, what an agent changes carries its name for a few seconds, in uva, the
colour reserved for agents: a halo on the card or node, its edges drawing themselves, a
"… is writing" pill, and the map follows the newest idea unless the person moved it in the
last five seconds. An idea with no position yet is placed next to the idea it hangs from,
the same way on every device.
