<p align="center"><img src="brand/svg/noergo-horizontal.svg" alt="noergo" width="320"></p>

<p align="center"><b>属于你和 AI 智能体的可视化记忆。</b><br>
像 Trello 一样的看板、思维导图，以及像 Obsidian 一样的知识图谱，一键切换。<br>
ChatGPT、Claude 和 Grok 与你实时一起阅读、编写和连接笔记。</p>

<p align="center"><a href="README.md">English</a> · <a href="README.pt-BR.md">Português</a> · <a href="https://noergo.com">noergo.com</a></p>

---

## 这是什么

noergo 用来存放你正在思考和做的事：项目、想法、待办、需要记住的东西。你在列中写笔记、
拖动它们，还可以把一列或整个看板切换成思维导图；每条笔记和每个连接也都存在于一张汇集
你所有知识的图谱中。输入 `[[双链]]` 就能把笔记连起来。

你的 AI 智能体通过 [MCP](https://modelcontextprotocol.io) 连接。它们可以搜索和阅读笔记、
写新笔记、补充旧笔记、连接想法、整理列——你会在打开的页面里实时看到这一切，每次修改都
标明来源并且可以撤销。

## 三种使用方式

| | |
|---|---|
| **免费** — [noergo.com](https://noergo.com) | 看板和笔记不限数量。使用 Google 或 Microsoft 登录。 |
| **Pro** — 每月 10 美元 | 包含免费版全部功能，另有通过 MCP 连接的 AI 智能体和个人 API 令牌。7 天试用。 |
| **开源** — 本仓库 | 部署在你自己的服务器上，所有功能全部可用。[自托管指南](docs/self-hosting.md)（英文）。 |

## 当前状态

正在开发中，尚未发布第一个版本。数据库层和领域操作已经完成并有测试；界面、登录、MCP
服务器和计费正在分阶段构建。

## 开发

需要：Node.js 22、PostgreSQL 18（Homebrew 的 `postgresql@18`，或设置 `PG_BIN`）。

```sh
npm install
git config core.hooksPath .githooks   # 提交前用 gitleaks 检查密钥
npm run db:dev                        # 本地 PostgreSQL 18，127.0.0.1:5434，已建好表结构
npm run check                         # 类型检查、lint、测试、依赖审计
npm run dev                           # web 运行在 http://localhost:3041
```

请阅读 [CLAUDE.md](CLAUDE.md)（代码里看不出来的规则）、
[docs/architecture.md](docs/architecture.md) 和 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 安全

请私下报告漏洞，见 [SECURITY.md](SECURITY.md)。

## 许可证

[AGPL-3.0](LICENSE)。如果你把修改过的 noergo 作为网络服务运行，必须向其用户提供源代码。
noergo 的名称和标志不在许可范围内，见 [brand/TRADEMARK.md](brand/TRADEMARK.md)。
