<p align="center"><img src="assets/icon.png" alt="The Althing" width="84"></p>

<h1 align="center">The Althing</h1>

<p align="center"><strong>在 CodexHost 工作区，召集一场奥林匹斯诸神议会。</strong><br>让不同模型像各有所长的诸神一样各据一席，围绕同一问题独立调查、相互质询。最后由主持人把共识、依据和尚存的分歧写进报告。</p>

<p align="center">⭐ 如果议事厅对你有帮助，欢迎为项目点一颗星！ ⭐</p>

<p align="center"><a href="https://github.com/mythezone/codexhost-ext-the-althing/releases/latest"><img src="https://img.shields.io/github/v/release/mythezone/codexhost-ext-the-althing?style=flat-square&amp;label=Release" alt="Latest Release"></a> <a href="../../LICENSE"><img src="https://img.shields.io/badge/License-MIT-407249?style=flat-square" alt="License MIT"></a> <a href="https://github.com/BytePioneer-AI/codexhost-extensions-registry"><img src="https://img.shields.io/badge/CodexHost-Extension%20v2-5268a1?style=flat-square" alt="CodexHost Extension v2"></a> <img src="https://img.shields.io/badge/Platforms-Desktop%20%7C%20Web%20%7C%20Mobile-4b6277?style=flat-square" alt="Platforms Desktop | Web | Mobile"> <img src="https://img.shields.io/badge/Languages-EN%20%7C%20%E7%AE%80%E4%BD%93%E4%B8%AD%E6%96%87%20%7C%20%E7%B9%81%E9%AB%94%E4%B8%AD%E6%96%87%20%7C%20%E6%97%A5%E6%9C%AC%E8%AA%9E%20%7C%20%ED%95%9C%EA%B5%AD%EC%96%B4-4b6277?style=flat-square" alt="Languages EN | 简体中文 | 繁體中文 | 日本語 | 한국어"></p>

<p align="center"><img src="https://img.shields.io/badge/Codex-183830?style=for-the-badge" alt="Codex"> <img src="https://img.shields.io/badge/Claude%20Code-a54c33?style=for-the-badge" alt="Claude Code"> <img src="https://img.shields.io/badge/Antigravity-4b548b?style=for-the-badge" alt="Antigravity"> <img src="https://img.shields.io/badge/Grok-20242c?style=for-the-badge" alt="Grok"> <img src="https://img.shields.io/badge/CodeBuddy-246066?style=for-the-badge" alt="CodeBuddy"> <img src="https://img.shields.io/badge/Cursor%20CLI-4e5267?style=for-the-badge" alt="Cursor CLI"> <img src="https://img.shields.io/badge/%2B%20More%20Host%20Agents-495768?style=for-the-badge" alt="+ More Host Agents"></p>

<p align="center"><a href="#install">安装</a> · <a href="#quick-start">快速开始</a> · <a href="#features">功能</a> · <a href="#screenshots">截图</a> · <a href="#development">开发</a> · <a href="https://github.com/mythezone/codexhost-ext-the-althing/releases">版本发布</a> · <a href="https://github.com/mythezone/codexhost-ext-the-althing/issues">问题反馈</a> · <a href="README.md">English</a> · <a href="README.ja.md">日本語</a> · <a href="README.ko.md">한국어</a></p>

<p align="center"><img src="assets/art/council.webp" alt="The Althing" width="720"></p>

<a id="install"></a>

## 安装

Desktop 打开**设置 → 插件**，Web 打开**插件 → 插件中心**。在市场中找到**议事厅 / The Althing**（`the-althing`），安装并启用。

手动安装时，从最新稳定版本下载 **`the-althing.zip`**，在插件中心导入 ZIP 并启用。若选择从 GitHub 跟踪稳定更新，仓库填 `mythezone/codexhost-ext-the-althing`，附件选 `the-althing.zip`，标签留空。

[版本发布](https://github.com/mythezone/codexhost-ext-the-althing/releases/latest) · [CodexHost Extensions Registry](https://github.com/BytePioneer-AI/codexhost-extensions-registry)

<a id="quick-start"></a>

## 快速开始

```text
/althing 末班车之后，哪条公交线路值得延时试点？
```

1. 在 Desktop 或 Web 聊天框输入 `/althing <议题>`（支持单行或多行说明），回车或点击发送按钮——与 `/goal` 一样**直接发送到议事厅立即开会**，无需弹出多步向导。（输入 `/alt` 按 `Tab` 可自动补全为 `/althing `。）
2. 议事厅自动识别当前项目工作区，结合议题与 CodexHost 已就绪的多 Agent 协作配置，**智能分配专家人数、席位模型/推理强度与互补角色**，并立即由主持人规划议程、细化各席位角色。
3. 规划完成后**自动派发首轮讨论**。你可以在总览顶部的启动卡片中实时查看进度、一键点击「暂停自动派发」或随时进入「配置专家与角色」微调分工。
4. 如需开会前手动定制，可输入单独的 `/althing`、`/althing --custom <议题>`（也支持 `--debate` / `--rapid` / `--experts 4`），或点击 **新建议题** 打开单页快速配置弹窗。

<a id="features"></a>

## 功能

| 功能 | 用途 |
| --- | --- |
| `/althing` 直达开会 | 像 `/goal` 一样直接从聊天框发送 `/althing <议题>`（支持多行），零向导一键开会；支持 `Tab` 补全及 `--debate`、`--rapid`、`--experts N`、`--custom` 参数。 |
| 智能席位、人数与角色分配 | 自动结合议题与宿主已就绪的协作 Agent 决定专家人数、模型、推理强度与领域角色，主持人规划时自动细化角色，且随时支持全手动微调。 |
| 自动启动与实时进度 | 规划议程后自动派发首轮讨论（支持插件设置或单议题启动卡片开关），实时跟踪子会话进度、取消或重试任务。 |
| 讨论协议 | 选择标准议事、对抗辩论或快速专家组；可并行或按顺序派发，针对指定发言发起反驳。 |
| 报告与 ZIP 归档 | 阅读、打印报告，下载 HTML 或 Markdown，用 ZIP 把整场会议迁移至另一台宿主。 |
| 桌面、网页和移动端 | 支持议题广场行内快速开会、桌面项目侧栏与网页面板；窄屏将议程结论排列为卡片，宽表支持手势横向滚动。 |
| 界面语言 | 支持英文、简体中文、繁体中文、日语和韩语。默认跟随 CodexHost，未识别语言时使用英文。也可在插件设置的**界面语言**中手动指定。 |

<a id="screenshots"></a>

## 界面截图

![议题广场：按项目查看进行中与已归档的会议。](assets/screenshots/hub.webp)

议题广场：按项目查看进行中与已归档的会议。

![议题总览：查看主持人的结论、要点与未决分歧。](assets/screenshots/overview.webp)

议题总览：查看主持人的结论、要点与未决分歧。

![子议程讨论：按轮次阅读专家回应，并按需展开发言全文。](assets/screenshots/discussion.webp)

子议程讨论：按轮次阅读专家回应，并按需展开发言全文。

![报告阅读器：查看正文和表格，或打印为 PDF。](assets/screenshots/report-reader.webp)

报告阅读器：查看正文和表格，或打印为 PDF。

<a id="roadmap"></a>

## 路线图

以下为待探索方向，尚未排期。

- 邀请不同宿主上的专家加入同一场会议。
- 提前发出议程，由受邀者确认参与席位。
- 按议程和专家回顾讨论耗时及模型提供的用量记录。

<a id="development"></a>

## 开发与架构

Desktop 和 Web 共用 React 工作区。ESM 后端在本地保存议题，通过 CodexHost 委派任务。开发环境使用 Node.js 22.12+ 和 npm。

```sh
npm ci
npm run typecheck
npm run build
npm run pack
npm run validate:registry
npm test
```

首次运行触控和窄屏回归前安装 Chromium 和 WebKit。

```sh
npx playwright-core install chromium webkit
npm run test:mobile
```

本机安装时，在插件中心导入含 `manifest.json` 的构建目录 `dist/` 并启用。发布附件位于 `dist-release/`。

<a id="backend-contract"></a>

### 后端契约

所有 RPC 均以 `althing/` 为前缀。资源字段使用 snake_case，调用参数使用 `topicId` 等名称。内置客户端负责后台操作回执和分块传输。

| RPC 分组 | 调用说明 |
| --- | --- |
| `capabilities, codexhost/*` | 发现方法及宿主工作区。`agents({ cwd?, refresh? })` 返回就绪状态、协作默认值及模型支持的推理等级。 |
| `topics/*` | 创建、列出、获取、更新或删除议题。`get({ topicId, summaryOnly: true })` 省略长文本，`body({ topicId, kind, resourceId })` 按需取单条发言或任务正文。 |
| `agendas/*, sub-agendas/*, dispatches/*, contributions/*` | 创建议程、子议程、任务和发言，也可更新发言摘要与标签。已发表的发言原文不可编辑。 |
| `council/*` | 智能推荐席位（`recommend-panel`）、一键开会（`convene`）、开关自动派发（`set-auto-dispatch`）、规划议程、派发讨论、生成综述、议程结论和报告。列出任务，按 `runId` 取消或重试。 |
| `reports/*` | 发布报告，或用 `topicId` 和 `reportId` 单独取完整报告。报告与离线阅读器可指定外壳语言。 |
| `archives/*, exports/*` | 创建与列出归档，使用 `import-begin`、`import-chunk`、`import-commit` 分块导入。按序下载每块 512 KiB 的 ZIP、独立 HTML 或 Markdown 包。 |
| `operations/get, events/since, transfers/release` | 用 `operationId` 轮询后台回执。大型 JSON 按块解码 base64，拼成 UTF-8 并释放传输资源。用游标回放事件，日志被截断时刷新。 |

<a id="contributing"></a>

## 参与贡献

反馈问题时请注明宿主版本、界面语言和复现步骤。提交改动时请发起范围明确的 PR，补充对应测试并运行上述校验。添加翻译时请更新 `src/shared/` 的共享词表，在工作区和聊天命令提示中核对效果，并附上改动控件的截图。

[问题反馈](https://github.com/mythezone/codexhost-ext-the-althing/issues) · [Pull requests](https://github.com/mythezone/codexhost-ext-the-althing/pulls)

<a id="contributors"></a>

## 贡献者

维护者 [@mythezone](https://github.com/mythezone) · [查看全部贡献者](https://github.com/mythezone/codexhost-ext-the-althing/graphs/contributors)

<a id="acknowledgements"></a>

## 致谢

感谢 CodexHost 提供项目工作区、Agent 目录和委派接口，感谢扩展注册表维护插件市场目录。 [CodexHost](https://github.com/BytePioneer-AI/codex-host) · [CodexHost Extensions Registry](https://github.com/BytePioneer-AI/codexhost-extensions-registry)

使用的开源依赖 [React](https://react.dev), [Marked](https://marked.js.org), [DOMPurify](https://github.com/cure53/DOMPurify), [parse5](https://parse5.js.org), [Zod](https://zod.dev), [Lucide](https://lucide.dev), [esbuild](https://esbuild.github.io).

<a id="license"></a>

## 许可证

本项目使用 MIT 许可证。 [MIT](../../LICENSE)
