<p align="center"><img src="brand/svg/noergo-horizontal.svg" alt="noergo" width="320"></p>

<p align="center"><b>让你的想法成形。</b><br>
每个想法都放在一个看板里，可以按列、按卡片或以思维导图的形式查看。<br>
和 ChatGPT、Grok 或 Claude 聊一聊：它们和你一起思考，noergo 实时把它画出来。</p>

<p align="center"><a href="README.md">English</a> · <a href="README.pt-BR.md">Português</a> · <a href="https://noergo.com">noergo.com</a></p>

---

## 这是什么

noergo 存放你正在思考的事：一个项目、一次旅行、一本书、一个决定。每一件都是一个**想法**，
想法放在**看板**里，每个想法汇集它的点子。一个想法有三种看法：

- **列**，像 Trello：每个想法是一列，点子是可以拖动的卡片。
- **卡片**，像相册：每个想法是一张带封面和颜色的卡片。
- **思维导图**：想法位于中心，点子从中展开并相互连接。

把一个想法拖到另一个看板的标签上，就能把它移过去。输入 `[[双链]]` 就能把点子连起来。

## 和你的智能体一起出声思考

负责思考的是你已经在用的智能体：ChatGPT、Grok、Claude 等。noergo 是这些思考的图像。
智能体通过 [MCP](https://modelcontextprotocol.io) 连接，能读取你保存的一切；你说话时，
它们会往打开的想法里添加点子、把点子连起来、附上图片。把思维导图留在一个标签页里，
你说着话，就能看着它长出来。

和 Grok 语音交谈，或者给 ChatGPT 打字、口述。智能体做的每一处修改都署有它的名字，
并且可以撤销。

## 三种使用方式

| | |
|---|---|
| **免费** — [noergo.com](https://noergo.com) | 看板和笔记不限数量。使用 Google 或 Microsoft 登录。 |
| **Pro** — 每月 10 美元 | 包含免费版全部功能，另有通过 MCP 连接的 AI 智能体和个人 API 令牌。7 天试用。 |
| **开源** — 本仓库 | 部署在你自己的服务器上，所有功能全部可用。[自托管指南](docs/self-hosting.md)（英文）。 |

## 当前状态

noergo.com 已经上线：看板、按列、卡片和思维导图查看的想法，以及多设备间的实时同步。
面向智能体的 MCP 服务器、知识图谱和计费正在构建中；在计费上线之前，智能体按账户逐个开通。

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
