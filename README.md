# The Althing · 议事厅

**The Althing（议事厅）**得名于冰岛议会 Alþingi。约公元 930 年，人们便在 Þingvellir 集会议事。[冰岛议会的历史介绍](https://www.althingi.is/pdf/Althingi2011_enska.pdf)

在 CodexHost 里，你可以围绕一个项目问题召集几位模型专家，请它们独立分析、互相质询，再由主持模型把共识、分歧和各自的理由写进同一份报告。

![议事厅封面，取自插件的议题广场](packages/codexhost-extension/assets/art/council.webp)

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

To follow stable GitHub releases, use the source `mythezone/codexhost-ext-the-althing` and asset `the-althing.zip`, leaving the tag empty.

## 界面预览

### 议题广场

按项目筛选会议，查看哪些议题仍在讨论，哪些已有报告。

![议题广场中的项目筛选、状态筛选和议题卡片](packages/codexhost-extension/assets/screenshots/hub.webp)

### 议题总览

从同一页查看各项议程的结论、要点和未决分歧。

![议题总览中的摘要、关键结论和议程结论矩阵](packages/codexhost-extension/assets/screenshots/overview.webp)

### 子议程讨论

沿着一轮任务查看各位专家的回应，展开原文可以读到完整论证。

![子议程讨论中的派发任务、专家署名和发言摘要](packages/codexhost-extension/assets/screenshots/discussion.webp)

### 报告阅读器

在议题内打开报告，阅读正文和表格，也可以打印或下载 HTML。

![报告阅读器中的章节标题、正文和表格](packages/codexhost-extension/assets/screenshots/report-reader.webp)

## Build

Use Node 22.12 or newer. The extension lives in `packages/codexhost-extension` and uses the two shared JSON schemas in `packages/protocol`.

```sh
cd packages/codexhost-extension
npm ci
npm run typecheck
npm test
npm run validate:registry
```

See the [extension README](packages/codexhost-extension/README.md) for mobile touch tests, local installation, council workflows and backend contracts.

[MIT License](LICENSE)
