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

Conflicts: simple fields are last-writer-wins; tags are add/remove; a note body is edited
by patch against a base version, and a replacement with a stale version is refused with the
current one attached, so the client (or the agent) can merge and retry.

## Agents

Agents connect over MCP with OAuth 2.1 (dynamic client registration, PKCE, resource
indicators, opaque tokens) or with a personal token. The tools read (search, fetch, boards,
recent activity) and write (create, update, append, edit a passage, move, link, archive).
Every change made by an agent is attributed to it, shown live, and can be reverted from the
activity feed. Agents cannot hard-delete; a revision is kept before each of their edits.
