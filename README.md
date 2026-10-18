<p align="center"><img src="brand/svg/noergo-horizontal.svg" alt="noergo" width="320"></p>

<p align="center"><b>Where your thoughts take shape.</b><br>
Each thought lives on a board and can be seen as columns, as cards or as a mind map.<br>
Talk it through with ChatGPT, Grok or Claude: they do the thinking with you, and noergo draws it, live.</p>

<p align="center"><a href="README.pt-BR.md">Português</a> · <a href="README.zh-CN.md">中文</a> · <a href="https://noergo.com">noergo.com</a></p>

---

## What it is

noergo keeps what you are thinking about: a project, a trip, a book, a decision. Each one
is a **thought**, thoughts live on **boards**, and a thought holds its ideas. You can look at
a thought three ways:

- **Columns**, like Trello: each thought is a column, its ideas are cards you drag around.
- **Cards**, like a photo library: each thought is a tile with its cover and colour.
- **Mind map**: the thought sits in the middle, its ideas branch out and connect.

Drag a thought onto another board's tab to move it there. `[[Wikilinks]]` connect ideas as
you type.

## Think out loud with your agents

The reasoning comes from the agents you already use: ChatGPT, Grok, Claude and others.
noergo is the picture of it. Agents connect over [MCP](https://modelcontextprotocol.io) and
read everything you keep; while you talk, they add ideas to the thought you have open,
connect them and attach pictures. Leave the mind map open in a tab and watch it grow as you
speak.

Talk to Grok by voice, or type or dictate to ChatGPT. Every change an agent makes carries
its name, and you can undo it.

## Three ways to use it

| | |
|---|---|
| **Free** — [noergo.com](https://noergo.com) | Unlimited boards and notes. Sign in with Google or Microsoft. |
| **Pro** — USD 10/month | Everything in Free, plus AI agents over MCP and personal API tokens. 7-day trial. |
| **Open source** — this repository | Run it on your own server, with every feature. [Self-hosting guide](docs/self-hosting.md). |

## Status

noergo.com is live: boards, thoughts as columns, cards and mind maps, and live sync across
your devices. The MCP server for agents, the knowledge graph and billing are being built;
until billing exists, agents are switched on account by account.

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
