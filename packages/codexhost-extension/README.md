# The Althing · 议事厅

**The Althing（议事厅）**以古希腊神话中的奥林匹斯诸神议事厅为意象：各有所长的模型化身议事席位，围绕同一议题围坐辩论、彼此质询，由主持模型汇总共识、分歧与依据并沉淀为清晰报告。

![议事厅封面，取自插件的议题广场](assets/art/council.webp)

## 安装

1. 打开 CodexHost 的插件中心。Desktop 从**设置 → 插件**进入，Web 从**插件 → 插件中心**进入。
2. 在市场中找到 **The Althing / 议事厅**（扩展 ID 为 `the-althing`），安装并启用。

需要手动安装时，从最新 Release 下载 **`the-althing.zip`**，在插件中心导入 ZIP 并启用。[下载最新版本](https://github.com/mythezone/codexhost-ext-the-althing/releases/latest)

## 发起第一场会议

在 Desktop 或 Web 的聊天框输入下面这行并按回车，也可以点击输入框旁的**发起会议**。单独输入 `/althing` 可在向导中填写主题。

```text
/althing 如何把新用户的首次配置缩短到五分钟？
```

1. **选工作区和专家。** 比如邀请两位专家，分别从用户体验和工程实现的角度分析。向导会列出 CodexHost 已就绪的 Agent 及默认模型和推理强度。点「一键加入协作专家」可沿用宿主的协作配置，也可以逐席选择 Agent、模型、推理强度和会议角色，或填写自定义角色。通过聊天命令建会时，默认由第一位专家兼任主持，也可以另选主持模型。
2. **请主持人拟议程。** 在向导里写下关心的问题，例如「哪一步最容易放弃？怎样衡量改动是否有效？」。选择**创建并规划议程**，等待主持模型列出议程和子议程，再审阅或补充。也可以手动填写议程。
3. **派发、综述、出报告。** 打开一个子议程，点**派发讨论**并选定本轮专家。发言结束后可针对某条发言发起质询，或点**主持人综述**。最后在议程页选**生成议程结论与报告**，或在议题操作中选**生成总报告**。

## 已支持的功能

| 功能 | 可以做什么 |
| --- | --- |
| 聊天命令 `/althing` | 输入命令打开会议向导，也可用 `/althing 会议主题` 预填标题。 |
| 专家与主持人 | 在向导或未归档议题的「专家名册 → 配置专家与角色」里更换专家和主持人的 Agent、模型、推理强度与分工。已参与讨论的席位保留历史记录。主持模型可规划议程、综合发言并撰写报告。 |
| 讨论协议 | 选择标准议会、对抗辩论或快速评议。子议程可并行或顺序发言，质询和反驳可指定要回应的发言。 |
| 进度与子会话 | 查看各席位的任务状态、进度和发言原文，打开对应子会话，取消进行中的任务或重试失败任务。 |
| 报告与归档 | 阅读或打印议程报告和总报告，导出独立 HTML 或 Markdown 包，用 ZIP 归档、迁移和恢复整场会议。 |
| 项目与侧栏 | 按项目、状态或关键词查找议题。Desktop 只在有议题的项目下显示议事厅，顶部入口默认在议题进行时显示，可在插件设置中调整。 |

## 未来设想

以下是可探索的方向，尚未排期。

- **跨机器参会。** 让不同 CodexHost 实例上的专家加入同一场会议，各自在自己的机器上完成发言。
- **邀请与预约。** 发起人提前发送议程和参会时间，受邀者确认参加，并选择愿意提供的模型。
- **会议用量回顾。** 会后按议程和专家查看耗时、轮次与模型提供的用量记录，作为下次选择专家阵容的参考。

## English quick start

Install and enable **The Althing** from the CodexHost plugin marketplace. In a Desktop or Web chat, enter `/althing How can we simplify onboarding?`. Choose a workspace, experts and moderator, then select **Create and plan agenda**. Review the proposed sub-agendas and select **Dispatch round** when you are ready for the experts to speak. Use **Configure roles & agents** in the expert roster to change assignments for later rounds. You can then request a synthesis, publish the final report, or export the council as a ZIP.

## 界面预览

### 议题广场

按项目筛选会议，查看哪些议题仍在讨论，哪些已有报告。

![议题广场中的项目筛选、状态筛选和议题卡片](assets/screenshots/hub.webp)

### 议题总览

从同一页查看各项议程的结论、要点和未决分歧。

![议题总览中的摘要、关键结论和议程结论矩阵](assets/screenshots/overview.webp)

### 子议程讨论

沿着一轮任务查看各位专家的回应，展开原文可以读到完整论证。

![子议程讨论中的派发任务、专家署名和发言摘要](assets/screenshots/discussion.webp)

### 报告阅读器

在议题内打开报告，阅读正文和表格，也可以打印或下载 HTML。

![报告阅读器中的章节标题、正文和表格](assets/screenshots/report-reader.webp)

## Build and verify

Run from this package with Node 22.12 or later and npm.

```sh
npm ci
npm run typecheck
npm run build
npm run pack
npm run validate:registry
npm test
```

To run the mobile touch regression, run `npx playwright-core install chromium webkit` once, then `npm run test:mobile`. It opens the built Web panel in Chromium and WebKit and checks scrolling, narrow-screen controls, rotation, conclusion cards, scrollable report tables, and the council wizard inside a height-constrained host.

The build writes a self-contained extension to `dist/`. For backend-only development, `npm run build:backend` rebuilds `dist/backend/index.mjs`. The page bundles React and the council app. Web registers a main-workspace panel that imports the page bundle. Desktop registers a classic script and mounts the app in a private shadow root. On phones, agenda conclusions appear as cards. Swipe wide tables inside discussions, the roster, and reports. Opening or downloading an older report adapts its layout while preserving its stored content and print script. All three surfaces share the same data directory and RPC contracts.

## Local installation

Open the CodexHost plugin center, import a local directory using `localDir`, select this package’s absolute `dist/` path (the directory containing `manifest.json`), and enable **The Althing / 议事厅**. Rebuild and update the local installation after changing code.

The wizard combines configured projects, the default workspace and recent thread directories. The Desktop sidebar can supply additional project paths. Choose a local absolute workspace for delegation. Harness, model and thinking options come from the Host. Theme and sidebar settings are available in the plugin center.

For release-based updates, use the GitHub source `mythezone/codexhost-ext-the-althing` with release asset `the-althing.zip`. Leave the tag empty to follow the latest stable release. A plugin originally installed by uploading a ZIP needs an explicit source on its first update. Updating the existing extension ID preserves its council data.

## Package and submit

1. Set the release version in `manifest.json` and the npm package metadata. Build, pack and run the validation commands above.
2. `dist-release/` contains `the-althing.zip`, the individual `icon.png`, any declared screenshots, `SHA256SUMS.txt`, and `sources-the-althing.json`. The ZIP has a root manifest. The packer uses the council's own DEFLATE/STORE writer.
3. Publish a stable release of the manifest's public GitHub repository. Attach exactly one ZIP named `the-althing.zip`, the separate image assets with their generated filenames, `SHA256SUMS.txt`, and `sources-the-althing.json`. Give changed ZIP bytes a new version.
4. Submit the public repository URL through the marketplace's extension submission issue form. The registry maintainers can copy `sources-the-althing.json` to `sources/the-althing.json`. Registry CI validates the public release and generates catalog metadata. [Marketplace registry and submission instructions](https://github.com/BytePioneer-AI/codexhost-extensions-registry)
 
Local validation runs the upstream validator pinned in `package-lock.json` against a local representation of the prospective GitHub release. It checks the on-disk release assets, compares packaged files with `dist/`, and links the page and Web module graphs with browser Rollup. Public release availability and catalog acceptance are checked by the registry after submission.

## Calling the backend

Every method starts with `althing/`. `capabilities` returns the registered methods. Resource fields use the Althing protocol’s snake_case names. RPC envelopes use camelCase IDs. For example, a page can create a council with `topics/create` and then schedule an opening round with `council/dispatch-round`.

```js
const topic = await invoke("topics/create", {
  data: {
    title: "Independent replication review",
    metadata: {
      codexhost: {
        project_cwd: project.cwd,
        project_label: project.name,
        panelist_threads: {
          reviewer: { harnessId: "codex", model: selectedModel, thinking: "high" }
        }
      }
    },
    panelists: [{ id: "reviewer", name: "Reviewer", role: "Replication reviewer" }],
    agendas: [{ title: "Evidence", sub_agendas: [{ title: "Replication" }] }]
  }
});
const { dispatch, runs } = await invoke("council/dispatch-round", {
  topicId: topic.id,
  subAgendaId: topic.agendas[0].sub_agendas[0].id,
  round_type: "opening",
  target_panelist_ids: ["reviewer"]
});
```

Here `invoke` denotes the shared RPC client method `rpc.call`, which handles both transport responses below.

- **Slow operation.** A call still running after 1.4 seconds returns `{ operationId, status: "pending" }`. Poll `operations/get` with `{ operationId }` until it returns the original result or throws the operation’s error. Completed receipts are available for five minutes within the current activation. Poll the receipt for a mutation to avoid submitting it twice.
- **Large JSON result.** `{ downloadId, encoding: "json", totalBytes }` identifies a stable UTF-8 JSON file. Call `exports/download-chunk` with `{ downloadId, chunkIndex }` starting at zero. Decode each base64 chunk individually, concatenate the bytes, then decode UTF-8 and parse JSON. Call `transfers/release` with `{ transferId: downloadId }` when finished.

| RPC family | Request and result |
| --- | --- |
| `topics` | `create({ data })`, `get({ topicId, summaryOnly? })`, `body({ topicId, kind, resourceId })`, `update({ topicId, patch })`, `delete({ topicId })`, and `list({ q?, status?, tag?, projectCwd? })`. Lists return cards. Topic trees include report metadata. |
| `agendas`, `sub-agendas`, `dispatches`, `contributions` | Send `topicId` and `data` for creation. Sub-agendas take `agendaId`. Dispatches and contributions take `subAgendaId`. Updates take the resource ID and `patch`. |
| `reports` | `publish({ topicId, data })` returns report metadata. `get({ topicId, reportId })` returns the complete publication. |
| `archives` | Create or list with `topicId`. Download a saved archive with `{ topicId, archiveId, chunkIndex }`. `import-begin({ totalBytes })` allocates an `uploadId`. Send `import-chunk({ uploadId, chunkIndex, base64 })` for each 512 KiB chunk, then `import-commit({ uploadId })`. A repeated commit returns the same restored `topicId`. Release the upload after receiving this result. |
| `exports` | Start `download-chunk({ topicId, format, chunkIndex: 0 })`. Use the returned `downloadId` for subsequent chunks of that snapshot. Supported formats are `archive-zip`, `standalone-html`, and `markdown-bundle`. Release the download after assembly. |
| `events/since` | `{ cursor, topicId? }` returns `{ cursor, events, activeRunCount, truncated }`. Advance using the returned cursor. Refresh cards or the topic tree if older events have expired. |
| `codexhost` | `status`, `projects`, `threads`, `harnesses`, and `harness-inspect` provide Host inventory. Use `agents({ cwd?, refresh? })` for readiness, collaboration defaults and model-specific thinking choices. Inspect with `{ harnessId, cwd?, refresh? }`. Select the project from `projects` and an advertised model from the inspection catalog. |

The reader requests `summaryOnly: true` on entry. Each sub-agenda carries its contribution summaries once. Dispatches reference them by `contribution_ids`. The empty `full_content` and `prompt_full` fields have matching Unicode character counts in `full_content_length` and `prompt_full_length`. Expanding a response or prompt fetches `{ text }` from `topics/body` with kind `contribution` or `dispatch`. Omitting `summaryOnly` returns the complete topic tree.

## Council runs

- Dispatch accepts `round_number`, `round_type`, `target_panelist_ids`, `target_contribution_ids`, `prompt_full`, `prompt_summary`, and `refs`. Critiques and rebuttals continue the panelist’s existing thread. A sequential sub-agenda admits one slot at a time. Completed panelist slots contribute to progress, with one final slot reserved for synthesis.
- Moderator actions use `topicId`. `synthesize-sub-agenda` also takes `subAgendaId`. `conclude-agenda` takes `agendaId` and optional `publishReport`. `generate-report` accepts an optional `agendaId` and `completeTopic` for a final report. `plan-topic` appends the returned agenda plan after validating its dependencies. Moderator actions accept an optional `prompt` and `moderator_config`.
- `council/runs({ topicId })` returns persisted runs. `cancel-run` and `retry-run` take `{ topicId, runId }`. Cancellation of an active thread is asynchronous. A retry has a new run ID and the same discussion slot.
- The Host reads backend settings on activation. Reactivate after changing the data directory, endpoint, token, or default protocol. Open views subscribe to theme and sidebar settings.
- Import creates an archived topic with fresh resource IDs and a first archive snapshot. Historical run links point to the restored resources. An unfinished source turn is recorded as cancelled in the copy, and its original status is retained in `archivedStatus`. Thread handles in the imported roster are historical.

## Storage and verification

The Host IPC thread and the storage/orchestration worker share one process. The worker has a 128 MiB old-space limit. Storage writes stage private files, commit a redo journal, and recover interrupted transactions on open. Report bodies reside in separate files. The local Host credential file is discovered from the Host data root independently of a custom council directory.

The frontend tests mount the production bundles in Shadow DOM and exercise the Desktop sidebar, the Web panel, and chunked transfers. Backend tests validate protocol schemas, Python v1 archive compatibility, storage recovery and a complete council against an in-process HTTP Host. Packaging tests run the pinned registry validator on valid and invalid release fixtures. The binary fixture in `tests/fixtures/python-v1.zip` came from the repository’s Python archive writer.

