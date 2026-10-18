<p align="center"><img src="brand/svg/noergo-horizontal.svg" alt="noergo" width="320"></p>

<p align="center"><b>A visual memory for you and your AI agents.</b><br>
Boards like Trello, mind maps, and a knowledge graph like Obsidian — one click apart.<br>
ChatGPT, Claude and Grok read, write and connect your notes with you, live.</p>

<p align="center"><a href="README.pt-BR.md">Português</a> · <a href="README.zh-CN.md">中文</a> · <a href="https://noergo.com">noergo.com</a></p>

---

## What it is

noergo is where you keep what you are thinking and doing: projects, ideas, to-dos, things
to remember. You write notes in columns, drag them around, and switch a column or a whole
board into a mind map; every note and every connection also lives in one graph of
everything you know. `[[Wikilinks]]` connect notes as you type.

Your AI agents connect over [MCP](https://modelcontextprotocol.io). They search and read
your notes, write new ones, append to old ones, link ideas and tidy columns — and you see
it happen in the open tab, with every change attributed and reversible.

## Three ways to use it

| | |
|---|---|
| **Free** — [noergo.com](https://noergo.com) | Unlimited boards and notes. Sign in with Google or Microsoft. |
| **Pro** — USD 10/month | Everything in Free, plus AI agents over MCP and personal API tokens. 7-day trial. |
| **Open source** — this repository | Run it on your own server, with every feature. [Self-hosting guide](docs/self-hosting.md). |

## Status

Under active construction, before the first release. The database layer and the domain
operations exist and are tested; the interface, sign-in, MCP server and billing are being
built in phases.

## Development

Requirements: Node.js 22, PostgreSQL 18 (Homebrew `postgresql@18`, or set `PG_BIN`).

```sh
npm install
git config core.hooksPath .githooks   # gitleaks pre-commit check (install gitleaks)
npm run db:dev                        # local PostgreSQL 18 on 127.0.0.1:5434, schema applied
npm run check                         # typecheck, lint, tests, audit
npm run dev                           # web on http://localhost:3041
```

Read [CLAUDE.md](CLAUDE.md) (the rules that are not visible in the code),
[docs/architecture.md](docs/architecture.md) and [CONTRIBUTING.md](CONTRIBUTING.md).

## Security

Please report vulnerabilities privately — see [SECURITY.md](SECURITY.md).

## License

[AGPL-3.0](LICENSE). If you run a modified noergo as a network service, you must offer its
source to its users. The noergo name and logo are not covered by the license — see
[brand/TRADEMARK.md](brand/TRADEMARK.md).
