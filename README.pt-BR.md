<p align="center"><img src="brand/svg/noergo-horizontal.svg" alt="noergo" width="320"></p>

<p align="center"><b>Onde seus pensamentos ganham forma.</b><br>
Cada pensamento mora num quadro e pode ser visto em colunas, em cards ou como mapa mental.<br>
Converse com o ChatGPT, o Grok ou o Claude: eles raciocinam com você, e o noergo desenha, ao vivo.</p>

<p align="center"><a href="README.md">English</a> · <a href="README.zh-CN.md">中文</a> · <a href="https://noergo.com">noergo.com</a></p>

---

## O que é

O noergo guarda aquilo em que você está pensando: um projeto, uma viagem, um livro, uma
decisão. Cada um é um **pensamento**, os pensamentos moram em **quadros**, e um pensamento
reúne as suas ideias. Você vê um pensamento de três jeitos:

- **Colunas**, como no Trello: cada pensamento é uma coluna, e as ideias são cartões que
  você arrasta.
- **Cards**, como numa biblioteca de fotos: cada pensamento é um card com sua capa e sua cor.
- **Mapa mental**: o pensamento fica no centro, e as ideias saem dele e se ligam.

Arraste um pensamento até a aba de outro quadro para levá-lo para lá. `[[Wikilinks]]` ligam
as ideias enquanto você escreve.

## Pense em voz alta com seus agentes

Quem raciocina são os agentes que você já usa: ChatGPT, Grok, Claude e outros. O noergo é a
imagem desse raciocínio. Os agentes se conectam pelo [MCP](https://modelcontextprotocol.io)
e leem tudo o que você guarda; enquanto você fala, eles acrescentam ideias ao pensamento
aberto, ligam uma à outra e anexam imagens. Deixe o mapa mental aberto numa aba e veja-o
crescer enquanto você fala.

Fale com o Grok por voz, ou escreva ou dite para o ChatGPT. Cada mudança feita por um agente
leva o nome dele, e você pode desfazê-la.

## Como usar

O noergo é open source, e este repositório é ele inteiro: não há planos nem nada a pagar.

| | |
|---|---|
| [noergo.com](https://noergo.com) | A instância mantida pelo autor do projeto. Entre com Google ou Microsoft. |
| O seu servidor | O mesmo código, com todos os recursos. [Guia de auto-hospedagem](docs/self-hosting.md) (em inglês). |

Cada instância tem uma página de administração, dentro do app, para quem a administra: quem
pode criar conta, quem pode conectar agentes, quanto cada conta pode guardar, e as próprias
contas (bloquear e desbloquear, encerrar sessões, revogar agentes).

## Situação

No ar no noergo.com: quadros, pensamentos em colunas, cards e mapas mentais, sincronização
ao vivo entre seus aparelhos e agentes via MCP. O grafo de conhecimento está sendo construído.

## Contribua

O noergo cresce com as ideias de quem o usa.

- **Ideias e dúvidas**: nas [Discussions](https://github.com/nhkameda/noergo/discussions).
  Uma ideia que junta interesse vira issue.
- **Falhas**: nas [Issues](https://github.com/nhkameda/noergo/issues).
- **Código e traduções**: leia o [CONTRIBUTING.md](CONTRIBUTING.md); pull requests pequenos,
  com testes, nos três idiomas e assinados (DCO).
- **Vulnerabilidades**: em privado, nunca numa issue; veja o [SECURITY.md](SECURITY.md).

Quem participa segue o [Código de Conduta](CODE_OF_CONDUCT.md).

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
