<p align="center"><img src="brand/svg/noergo-horizontal.svg" alt="noergo" width="320"></p>

<p align="center"><b>Uma memória visual para você e seus agentes de IA.</b><br>
Quadros como o Trello, mapas mentais e um grafo de conhecimento como o Obsidian, a um clique de distância.<br>
ChatGPT, Claude e Grok leem, escrevem e conectam suas notas junto com você, ao vivo.</p>

<p align="center"><a href="README.md">English</a> · <a href="README.zh-CN.md">中文</a> · <a href="https://noergo.com">noergo.com</a></p>

---

## O que é

O noergo é onde você guarda o que está pensando e fazendo: projetos, ideias, pendências,
coisas para lembrar. Você escreve notas em colunas, arrasta, e transforma uma coluna ou um
quadro inteiro num mapa mental. Toda nota e toda ligação também vivem num grafo único de
tudo o que você sabe. `[[Wikilinks]]` ligam as notas enquanto você escreve.

Seus agentes de IA se conectam pelo [MCP](https://modelcontextprotocol.io). Eles buscam e
leem suas notas, escrevem novas, completam as antigas, ligam ideias e arrumam colunas. Você
vê tudo acontecer na aba aberta, com cada mudança identificada e reversível.

## Três formas de usar

| | |
|---|---|
| **Grátis** — [noergo.com](https://noergo.com) | Quadros e notas ilimitados. Entre com Google ou Microsoft. |
| **Pro** — USD 10/mês | Tudo do Grátis, mais agentes de IA via MCP e tokens pessoais de API. 7 dias de teste. |
| **Open source** — este repositório | Rode no seu próprio servidor, com todos os recursos. [Guia de auto-hospedagem](docs/self-hosting.md) (em inglês). |

## Situação

Em construção, antes da primeira versão. A camada de banco de dados e as operações de
domínio já existem e têm testes; a interface, o login, o servidor MCP e a cobrança estão
sendo construídos em fases.

## Desenvolvimento

Requisitos: Node.js 22, PostgreSQL 18 (`postgresql@18` do Homebrew, ou defina `PG_BIN`).

```sh
npm install
git config core.hooksPath .githooks   # checagem de segredos (gitleaks) antes do commit
npm run db:dev                        # PostgreSQL 18 local em 127.0.0.1:5434, com o schema
npm run check                         # tipos, lint, testes, auditoria
npm run dev                           # web em http://localhost:3041
```

Leia o [CLAUDE.md](CLAUDE.md) (as regras que não aparecem no código), o
[docs/architecture.md](docs/architecture.md) e o [CONTRIBUTING.md](CONTRIBUTING.md).

## Segurança

Relate vulnerabilidades em privado: veja o [SECURITY.md](SECURITY.md).

## Licença

[AGPL-3.0](LICENSE). Quem roda um noergo modificado como serviço de rede precisa oferecer o
código-fonte aos seus usuários. O nome e o logo do noergo não fazem parte da licença: veja o
[brand/TRADEMARK.md](brand/TRADEMARK.md).
