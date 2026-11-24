<p align="center"><img src="packages/codexhost-extension/assets/icon.png" alt="The Althing" width="84"></p>

<h1 align="center">The Althing</h1>

<p align="center"><strong>CodexHost 작업 공간에서 열리는 올림포스의 회의.</strong><br>모델마다 자리를 정하고 조사할 질문을 맡기세요. 전문가들이 서로의 주장을 검토하면 의장이 합의 사항과 남은 쟁점을 기록합니다.</p>

<p align="center">⭐ The Althing이 도움이 되었다면 별표를 눌러 주세요! ⭐</p>

<p align="center"><a href="https://github.com/mythezone/codexhost-ext-the-althing/releases/latest"><img src="https://img.shields.io/github/v/release/mythezone/codexhost-ext-the-althing?style=flat-square&amp;label=Release" alt="Latest Release"></a> <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-407249?style=flat-square" alt="License MIT"></a> <a href="https://github.com/BytePioneer-AI/codexhost-extensions-registry"><img src="https://img.shields.io/badge/CodexHost-Extension%20v2-5268a1?style=flat-square" alt="CodexHost Extension v2"></a> <img src="https://img.shields.io/badge/Platforms-Desktop%20%7C%20Web%20%7C%20Mobile-4b6277?style=flat-square" alt="Platforms Desktop | Web | Mobile"> <img src="https://img.shields.io/badge/Languages-EN%20%7C%20%E7%AE%80%E4%BD%93%E4%B8%AD%E6%96%87%20%7C%20%E7%B9%81%E9%AB%94%E4%B8%AD%E6%96%87%20%7C%20%E6%97%A5%E6%9C%AC%E8%AA%9E%20%7C%20%ED%95%9C%EA%B5%AD%EC%96%B4-4b6277?style=flat-square" alt="Languages EN | 简体中文 | 繁體中文 | 日本語 | 한국어"></p>

<p align="center"><img src="https://img.shields.io/badge/Codex-183830?style=for-the-badge" alt="Codex"> <img src="https://img.shields.io/badge/Claude%20Code-a54c33?style=for-the-badge" alt="Claude Code"> <img src="https://img.shields.io/badge/Antigravity-4b548b?style=for-the-badge" alt="Antigravity"> <img src="https://img.shields.io/badge/Grok-20242c?style=for-the-badge" alt="Grok"> <img src="https://img.shields.io/badge/CodeBuddy-246066?style=for-the-badge" alt="CodeBuddy"> <img src="https://img.shields.io/badge/Cursor%20CLI-4e5267?style=for-the-badge" alt="Cursor CLI"> <img src="https://img.shields.io/badge/%2B%20More%20Host%20Agents-495768?style=for-the-badge" alt="+ More Host Agents"></p>

<p align="center"><a href="#install">설치</a> · <a href="#quick-start">빠른 시작</a> · <a href="#features">기능</a> · <a href="#screenshots">스크린샷</a> · <a href="#development">개발</a> · <a href="https://github.com/mythezone/codexhost-ext-the-althing/releases">릴리스</a> · <a href="https://github.com/mythezone/codexhost-ext-the-althing/issues">이슈</a> · <a href="README.md">English</a> · <a href="README.zh-CN.md">简体中文</a> · <a href="README.ja.md">日本語</a></p>

<p align="center"><img src="packages/codexhost-extension/assets/art/council.webp" alt="The Althing" width="720"></p>

<a id="install"></a>

## 설치

데스크톱의 **설정 → 플러그인** 또는 웹의 **플러그인 → 플러그인 센터**에서 **The Althing** (`the-althing`)을 찾아 설치하고 활성화하세요.

수동으로 설치하려면 최신 안정 릴리스에서 **`the-althing.zip`**을 다운로드한 다음 플러그인 센터로 가져와 활성화하세요. GitHub에서 안정 버전을 업데이트하려면 저장소 `mythezone/codexhost-ext-the-althing`과 파일 `the-althing.zip`을 선택하고 태그를 비워 두세요.

[릴리스](https://github.com/mythezone/codexhost-ext-the-althing/releases/latest) · [CodexHost Extensions Registry](https://github.com/BytePioneer-AI/codexhost-extensions-registry)

<a id="quick-start"></a>

## 빠른 시작

```text
/althing 심야 버스 시범 노선은 어디로 정할까요?
```

1. 데스크톱 또는 웹 채팅에서 `/althing <주제>`(한 줄·여러 줄 지원)를 입력하고 **Enter** 또는 전송을 누르면 `/goal`처럼 복잡한 설정 마법사 없이 **바로 회의가 열립니다**. (`/alt`에서 `Tab`을 누르면 `/althing `으로 자동 완성됩니다.)
2. 현재 작업 공간을 자동 감지하고 준비된 CodexHost 협업 에이전트와 기본값으로 최적의 전문가 인원·모델·역할을 자동 배정하며, 의장이 의제를 기획하고 역할을 다듬습니다.
3. 의제 기획이 끝나면 **첫 라운드가 자동으로 시작**됩니다. 시작 카드에서 진행 상황을 보고 필요하면 **자동 시작 일시 중지**를 누르거나 언제든 **전문가 및 역할 설정**에서 조정할 수 있습니다.
4. 시작 전에 직접 구성하려면 `/althing`만 입력하거나 `/althing --custom <주제>`(`--debate`, `--rapid`, `--experts 4` 지원), 또는 **새 회의**로 1화면 빠른 설정 창을 여세요.

<a id="features"></a>

## 기능

| 기능 | 설명 |
| --- | --- |
| `/althing` 즉시 시작 | `/goal`처럼 채팅에서 `/althing <주제>`(여러 줄 지원)를 바로 보내 마법사 없이 즉시 회의를 엽니다. `Tab` 자동 완성 및 `--debate`, `--rapid`, `--experts N`, `--custom` 옵션을 지원합니다. |
| 스마트 좌석·인원·역할 배정 | 주제와 준비된 호스트 에이전트를 바탕으로 전문가 수, 모델, 사고 수준, 역할을 자동 배정하고 의제 기획 시 역할을 다듬습니다. 언제든 수동 변경이 가능합니다. |
| 자동 시작 및 진행 현황 | 의제 기획 후 첫 라운드를 자동 시작(플러그인 설정 또는 시작 카드에서 전환)하고 위임 스레드를 확인·취소·재시도합니다. |
| 토론 방식 | 표준 회의, 찬반 토론 또는 신속 패널을 선택해 병렬 또는 순차로 발언하고 특정 발언에 반론을 요청합니다. |
| 보고서 및 ZIP 보관 파일 | 보고서를 인쇄하거나 HTML 및 Markdown으로 내려받고 회의 전체를 다른 호스트로 옮깁니다. |
| 데스크톱·웹·모바일 | 회의 목록의 빠른 입력창, 데스크톱 프로젝트 또는 웹 패널에서 회의를 엽니다. 좁은 화면에서는 결론 카드와 가로로 스크롤하는 표를 제공합니다. |
| 인터페이스 언어 | 영어, 간체 및 번체 중국어, 일본어, 한국어를 지원합니다. 기본적으로 CodexHost의 언어를 따르고 지원하지 않는 언어에서는 영어를 사용합니다. 플러그인 설정에서 직접 선택할 수도 있습니다. |

<a id="screenshots"></a>

## 스크린샷

![회의 목록 — 프로젝트별로 진행 중인 회의와 보관된 회의를 확인합니다.](packages/codexhost-extension/assets/screenshots/hub.webp)

회의 목록 — 프로젝트별로 진행 중인 회의와 보관된 회의를 확인합니다.

![개요 — 의장의 결론과 아직 합의하지 못한 쟁점을 살펴봅니다.](packages/codexhost-extension/assets/screenshots/overview.webp)

개요 — 의장의 결론과 아직 합의하지 못한 쟁점을 살펴봅니다.

![토론 — 토론 차수별 진행 과정을 확인하고 개별 발언의 전문을 펼칩니다.](packages/codexhost-extension/assets/screenshots/discussion.webp)

토론 — 토론 차수별 진행 과정을 확인하고 개별 발언의 전문을 펼칩니다.

![보고서 뷰어 — 발행된 보고서의 표를 읽거나 PDF로 인쇄합니다.](packages/codexhost-extension/assets/screenshots/report-reader.webp)

보고서 뷰어 — 발행된 보고서의 표를 읽거나 PDF로 인쇄합니다.

<a id="roadmap"></a>

## 로드맵

검토 중인 아이디어이며 출시 일정은 정해지지 않았습니다.

- 여러 호스트의 전문가를 한 회의에 초대하기.
- 회의 전에 의제를 공유하고 참석 여부 확인하기.
- 전문가와 의제별 소요 시간 및 모델이 보고한 사용량 확인하기.

<a id="development"></a>

## 개발 및 구조

데스크톱과 웹이 React 화면을 공유합니다. ESM 백엔드는 회의를 로컬에 저장하며 CodexHost에 작업을 위임합니다. 개발에는 Node.js 22.12 이상과 npm을 사용하세요.

```sh
cd packages/codexhost-extension
npm ci
npm run typecheck
npm run build
npm run pack
npm run validate:registry
npm test
```

터치 및 좁은 화면 회귀 테스트에는 Chromium과 WebKit이 필요합니다.

```sh
npx playwright-core install chromium webkit
npm run test:mobile
```

로컬 설치 시 플러그인 센터에서 `manifest.json`이 들어 있는 `dist/` 디렉터리를 가져와 활성화하세요. 배포 파일은 `dist-release/`에 생성됩니다.

[확장 개발 안내 및 전체 백엔드 계약](packages/codexhost-extension/README.ko.md#backend-contract)

<a id="contributing"></a>

## 기여 방법

이슈에 호스트 버전, 언어와 재현 절차를 적어 주세요. 변경 사항과 회귀 테스트를 한 가지 주제의 PR로 제출하고 위 검사를 실행하세요. 번역을 기여하려면 `src/shared/`의 번역 목록을 수정하고 작업 공간 및 채팅 제안을 확인한 다음 화면을 첨부해 주세요.

[이슈](https://github.com/mythezone/codexhost-ext-the-althing/issues) · [Pull requests](https://github.com/mythezone/codexhost-ext-the-althing/pulls)

<a id="contributors"></a>

## 기여자

유지 관리자 [@mythezone](https://github.com/mythezone) · [전체 기여자](https://github.com/mythezone/codexhost-ext-the-althing/graphs/contributors)

<a id="acknowledgements"></a>

## 감사의 글

CodexHost는 작업 공간, 에이전트 목록 및 위임 API를 제공합니다. Extensions Registry는 마켓플레이스 목록을 배포합니다. [CodexHost](https://github.com/BytePioneer-AI/codex-host) · [CodexHost Extensions Registry](https://github.com/BytePioneer-AI/codexhost-extensions-registry)

사용한 오픈 소스 프로젝트 [React](https://react.dev), [Marked](https://marked.js.org), [DOMPurify](https://github.com/cure53/DOMPurify), [parse5](https://parse5.js.org), [Zod](https://zod.dev), [Lucide](https://lucide.dev), [esbuild](https://esbuild.github.io).

<a id="license"></a>

## 라이선스

MIT 라이선스로 배포됩니다. [MIT](LICENSE)
