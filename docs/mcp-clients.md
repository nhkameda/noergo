# Connecting agents

noergo is an MCP server at `https://<your domain>/mcp` (Streamable HTTP). Clients sign in
with OAuth 2.1 on their own; the person approves on noergo's consent page, choosing
read-only if they want, and can disconnect any client on the Agents page
(`/agents`). For anything without OAuth, a personal token from the same page goes in the
`Authorization: Bearer nrg_…` header.

What each client supports changes often. This is what their documentation said on
2026-10-19; check it again before relying on it.

| Client | Where | Sign-in | Writes | Voice |
|---|---|---|---|---|
| Grok | grok.com → Connectors → New connector → Custom | OAuth in the browser on first use | yes | documented: connectors work in Grok's voice mode |
| ChatGPT | chatgpt.com: turn on Developer mode (Settings → Apps), then create an app with the server URL | OAuth (client metadata document, or dynamic registration) | Business, Enterprise and Edu workspaces; Pro reads only; Plus has no custom servers | not documented for custom apps; dictation in a text chat works |
| Claude | claude.ai: Settings → Connectors → Add custom connector | OAuth | yes | — |
| Claude Code | `claude mcp add --transport http noergo https://<your domain>/mcp`, then `/mcp` to sign in | OAuth (dynamic registration, loopback redirect) | yes | — |
| Cursor | `mcp.json`: `{"mcpServers": {"noergo": {"url": "https://<your domain>/mcp"}}}` | OAuth (dynamic registration, loopback redirect) | yes | — |

Voice APIs that take a remote MCP server as a tool (OpenAI Realtime, xAI's Voice Agent)
can use a personal token as the `authorization` of that tool.

## What the server offers

- **Discovery.** A call without a token gets `401` with
  `WWW-Authenticate: Bearer resource_metadata="…/.well-known/oauth-protected-resource/mcp"`.
  That document names the authorization server (the site itself), whose metadata is at
  `/.well-known/oauth-authorization-server` and `/.well-known/openid-configuration`.
- **Clients.** A client metadata document (`client_id` is an `https://` URL) is fetched only
  from the hosts in `MCP_CIMD_HOSTS`. Any other client registers at `/oauth/register`
  (20 registrations per hour per address; one never used is removed after a day). A client
  whose redirect URIs are all loopback becomes a native app, so any port matches.
- **Tokens.** PKCE S256 is required. Access tokens are opaque, last an hour and are valid
  only for `/mcp` (resource indicators). Refresh tokens rotate; a refresh token used twice
  ends the whole connection. Scopes: `notes:read`, `notes:write`.
- **Calls.** Stateless: no session id, every POST carries its token. 120 calls per minute
  per connection. A browser `Origin` other than the site's is refused.

## Tools

Read: `search`, `fetch` (the pair ChatGPT's deep research expects), `list_boards`,
`get_thought`, `get_open_thought`, `get_recent_activity`. Write: `create_board`,
`create_thought`, `update_thought`, `add_notes`, `update_note`, `append_to_note`,
`edit_note_text`, `connect_notes`, `disconnect_notes`, `move_note`, `archive_note`. Every tool
has `readOnlyHint`, `destructiveHint` and `openWorldHint`, so clients can ask before a
change.

For a mind map spoken aloud, the agent calls `get_open_thought` (the thought the person
has on screen) and then `add_notes` with a few ideas at a time, each hanging from the
thought or from an earlier idea. They appear on the open map as they are written.
