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

## Use it

noergo is open source, and this repository is the whole of it: there are no plans and
nothing to pay.

| | |
|---|---|
| [noergo.com](https://noergo.com) | The instance the maintainer runs. Sign in with Google or Microsoft. |
| Your own server | The same code, every feature. [Self-hosting guide](docs/self-hosting.md). |

Each instance has an administration page, inside the app, for its administrators: who may
sign up, who may connect agents, how much each account may store, and the accounts
themselves (block and unblock, sign out everywhere, revoke agents).

## Status

Live on noergo.com: boards, thoughts as columns, cards and mind maps, live sync across your
devices, and agents over MCP. The knowledge graph is being built.

## Contribute

noergo grows with the ideas of the people who use it.

- **Ideas and questions**: [Discussions](https://github.com/nhkameda/noergo/discussions).
  An idea that gathers interest becomes an issue.
- **Bugs**: [Issues](https://github.com/nhkameda/noergo/issues).
- **Code and translations**: read [CONTRIBUTING.md](CONTRIBUTING.md); small pull requests,
  with tests, in the three languages, signed off (DCO).
- **Vulnerabilities**: privately, never in an issue; see [SECURITY.md](SECURITY.md).

Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md).

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
