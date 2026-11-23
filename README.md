<p align="center"><img src="packages/codexhost-extension/assets/icon.png" alt="The Althing" width="84"></p>

<h1 align="center">The Althing</h1>

<p align="center"><strong>A council on Olympus, convened in your CodexHost workspace.</strong><br>Give each model a seat and a question to investigate. Let the experts challenge one another, then ask the chair to record what they agree on and what remains open.</p>

<p align="center">⭐ If The Althing is useful to you, please give it a star! ⭐</p>

<p align="center"><a href="https://github.com/mythezone/codexhost-ext-the-althing/releases/latest"><img src="https://img.shields.io/github/v/release/mythezone/codexhost-ext-the-althing?style=flat-square&amp;label=Release" alt="Latest Release"></a> <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-407249?style=flat-square" alt="License MIT"></a> <a href="https://github.com/BytePioneer-AI/codexhost-extensions-registry"><img src="https://img.shields.io/badge/CodexHost-Extension%20v2-5268a1?style=flat-square" alt="CodexHost Extension v2"></a> <img src="https://img.shields.io/badge/Platforms-Desktop%20%7C%20Web%20%7C%20Mobile-4b6277?style=flat-square" alt="Platforms Desktop | Web | Mobile"> <img src="https://img.shields.io/badge/Languages-EN%20%7C%20%E7%AE%80%E4%BD%93%E4%B8%AD%E6%96%87%20%7C%20%E7%B9%81%E9%AB%94%E4%B8%AD%E6%96%87%20%7C%20%E6%97%A5%E6%9C%AC%E8%AA%9E%20%7C%20%ED%95%9C%EA%B5%AD%EC%96%B4-4b6277?style=flat-square" alt="Languages EN | 简体中文 | 繁體中文 | 日本語 | 한국어"></p>

<p align="center"><img src="https://img.shields.io/badge/Codex-183830?style=for-the-badge" alt="Codex"> <img src="https://img.shields.io/badge/Claude%20Code-a54c33?style=for-the-badge" alt="Claude Code"> <img src="https://img.shields.io/badge/Antigravity-4b548b?style=for-the-badge" alt="Antigravity"> <img src="https://img.shields.io/badge/Grok-20242c?style=for-the-badge" alt="Grok"> <img src="https://img.shields.io/badge/CodeBuddy-246066?style=for-the-badge" alt="CodeBuddy"> <img src="https://img.shields.io/badge/Cursor%20CLI-4e5267?style=for-the-badge" alt="Cursor CLI"> <img src="https://img.shields.io/badge/%2B%20More%20Host%20Agents-495768?style=for-the-badge" alt="+ More Host Agents"></p>

<p align="center"><a href="#install">Install</a> · <a href="#quick-start">Quick Start</a> · <a href="#features">Features</a> · <a href="#screenshots">Screenshots</a> · <a href="#development">Development</a> · <a href="https://github.com/mythezone/codexhost-ext-the-althing/releases">Releases</a> · <a href="https://github.com/mythezone/codexhost-ext-the-althing/issues">Issues</a> · <a href="README.zh-CN.md">简体中文</a> · <a href="README.ja.md">日本語</a> · <a href="README.ko.md">한국어</a></p>

<p align="center"><img src="packages/codexhost-extension/assets/art/council.webp" alt="The Althing" width="720"></p>

<a id="install"></a>

## Installation

Open **Settings → Plugins** on Desktop or **Plugins → Plugin Center** on Web. Find **The Althing** (`the-althing`) in the marketplace, install it and enable it.

For a manual install, download **`the-althing.zip`** from the latest stable release, import the ZIP in the plugin center and enable it. To follow stable updates from GitHub, select `mythezone/codexhost-ext-the-althing`, choose the asset `the-althing.zip` and leave the tag empty.

[Releases](https://github.com/mythezone/codexhost-ext-the-althing/releases/latest) · [CodexHost Extensions Registry](https://github.com/BytePioneer-AI/codexhost-extensions-registry)

<a id="quick-start"></a>

## Quick Start

```text
/althing Which transit corridor should we pilot after the last bus?
```

1. Enter the command in a Desktop or Web chat and press Enter, or choose **Start a council**. A bare `/althing` opens the same wizard with an empty title.
2. Choose the workspace and number of experts. **Add collaboration experts** uses the ready agents and their defaults from CodexHost. For each seat, choose its agent, model, thinking level and role. The first expert can chair the meeting, or you can select another moderator.
3. Use **Create and plan agenda** to have the chair propose sub-agendas. Review the plan, open a sub-agenda and select **Dispatch round** when you are ready for the experts to speak.
4. Read the opening statements, request a critique, then select **Synthesize**. Publish an agenda report or a final report. In an unarchived council, **Expert roster → Configure roles & agents** changes assignments for subsequent rounds.

<a id="features"></a>

## Features

| Feature | What you can do |
| --- | --- |
| `/althing` | Open the meeting wizard from chat, optionally with a topic already filled in. |
| Multi-agent collaboration & role assignment | See which host agents are ready. Use the host defaults or choose each expert’s and moderator’s model, reasoning level and role. |
| Discussion protocols | Run a standard council, adversarial debate or rapid panel. Dispatch in parallel or in sequence and target a particular contribution for rebuttal. |
| Progress & delegated threads | Follow each seat’s progress, inspect the delegated thread, cancel a running task or retry a failed one. |
| Reports & portable ZIP archives | Read and print reports, download HTML or Markdown, and move the whole council to another host in a ZIP. |
| Desktop, Web & Mobile | Find councils under their Desktop projects or open the Web panel. Narrow screens show conclusion cards and horizontally scrollable tables. |
| Interface languages | English, Simplified Chinese, Traditional Chinese, Japanese and Korean. The default follows CodexHost and falls back to English. Override it under **Interface language** in plugin settings. |

<a id="screenshots"></a>

## Screenshots

![Council hub — filter active and archived meetings by project.](packages/codexhost-extension/assets/screenshots/hub.webp)

Council hub — filter active and archived meetings by project.

![Overview — read the chair’s conclusions and unresolved questions.](packages/codexhost-extension/assets/screenshots/overview.webp)

Overview — read the chair’s conclusions and unresolved questions.

![Discussion — follow each round and expand individual contributions.](packages/codexhost-extension/assets/screenshots/discussion.webp)

Discussion — follow each round and expand individual contributions.

![Report reader — review a publication, inspect a table or print to PDF.](packages/codexhost-extension/assets/screenshots/report-reader.webp)

Report reader — review a publication, inspect a table or print to PDF.

<a id="roadmap"></a>

## Roadmap

Ideas under consideration, without a release schedule.

- Invite experts running on different hosts into the same council.
- Send an agenda in advance and let participants confirm their seats.
- Review time and model-reported usage by expert and agenda.

<a id="development"></a>

## Development & Architecture

The React workspace runs in Desktop and Web. An ESM backend stores councils locally and delegates work through CodexHost. Develop with Node.js 22.12+ and npm.

```sh
cd packages/codexhost-extension
npm ci
npm run typecheck
npm run build
npm run pack
npm run validate:registry
npm test
```

Install Chromium and WebKit once for the touch and narrow-screen regressions.

```sh
npx playwright-core install chromium webkit
npm run test:mobile
```

For local installation, import the built `dist/` directory (the one containing `manifest.json`) in the plugin center and enable it. Release files are written to `dist-release/`.

[Extension development guide and full backend contracts](packages/codexhost-extension/README.md#backend-contract)

<a id="contributing"></a>

## Contributing

Open an issue with the host version, language and steps to reproduce. For a change, open a focused pull request, add the relevant tests and run the checks above. For translations, update the shared catalog in `src/shared/`, check the language in both the workspace and the composer hint, and include a screenshot of changed controls.

[Issues](https://github.com/mythezone/codexhost-ext-the-althing/issues) · [Pull requests](https://github.com/mythezone/codexhost-ext-the-althing/pulls)

<a id="contributors"></a>

## Contributors

Maintained by [@mythezone](https://github.com/mythezone) · [All contributors](https://github.com/mythezone/codexhost-ext-the-althing/graphs/contributors)

<a id="acknowledgements"></a>

## Acknowledgements

CodexHost provides the workspaces, agent catalog and delegation API. The Extensions Registry distributes the marketplace catalog. [CodexHost](https://github.com/BytePioneer-AI/codex-host) · [CodexHost Extensions Registry](https://github.com/BytePioneer-AI/codexhost-extensions-registry)

Built with [React](https://react.dev), [Marked](https://marked.js.org), [DOMPurify](https://github.com/cure53/DOMPurify), [parse5](https://parse5.js.org), [Zod](https://zod.dev), [Lucide](https://lucide.dev), [esbuild](https://esbuild.github.io).

<a id="license"></a>

## License

Distributed under the MIT License. [MIT](LICENSE)
