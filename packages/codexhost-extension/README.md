# The Althing for CodexHost

The Althing brings project-based expert councils to CodexHost Desktop and Web. Choose a project and model roster, dispatch rounds, read agenda conclusions and follow each discussion, and publish and archive its conclusions.

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

Open the CodexHost plugin center, import a local directory using `localDir`, select this package’s absolute `dist/` path (the directory containing `manifest.json`), and enable **The Althing / 议事厅**. Rebuild and update the local installation after changing code. On Desktop, open the top-level sidebar item or expand a project's council group. On Web, select The Althing in the main navigation.

The wizard combines configured projects, the default workspace and recent thread directories. The Desktop sidebar can supply additional project paths. Choose a local absolute workspace for delegation. Harness, model and thinking options come from the Host. Theme and sidebar settings are available in the plugin center.

For release-based updates, use the GitHub source `mythezone/codexhost-ext-the-althing` with release asset `the-althing.zip`. Leave the tag empty to follow the latest stable release. A plugin originally installed by uploading a ZIP needs an explicit source on its first update. Updating the existing extension ID preserves its council data.

## Package and submit

1. Set the release version in `manifest.json` and the npm package metadata. Build, pack and run the validation commands above.
2. `dist-release/` contains `the-althing.zip`, the individual `icon.png`, any declared screenshots, `SHA256SUMS.txt`, and `sources-the-althing.json`. The ZIP has a root manifest. The packer uses the council's own DEFLATE/STORE writer.
3. Publish a stable release of the manifest's public GitHub repository. Attach the ZIP and the separate image assets with the exact generated filenames. Attach the checksums for download verification. Give changed ZIP bytes a new version.
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
| `topics` | `create({ data })`, `get({ topicId })`, `update({ topicId, patch })`, `delete({ topicId })`, and `list({ q?, status?, tag?, projectCwd? })`. Lists return cards. Topic trees include report metadata. |
| `agendas`, `sub-agendas`, `dispatches`, `contributions` | Send `topicId` and `data` for creation. Sub-agendas take `agendaId`. Dispatches and contributions take `subAgendaId`. Updates take the resource ID and `patch`. |
| `reports` | `publish({ topicId, data })` returns report metadata. `get({ topicId, reportId })` returns the complete publication. |
| `archives` | Create or list with `topicId`. Download a saved archive with `{ topicId, archiveId, chunkIndex }`. `import-begin({ totalBytes })` allocates an `uploadId`. Send `import-chunk({ uploadId, chunkIndex, base64 })` for each 512 KiB chunk, then `import-commit({ uploadId })`. A repeated commit returns the same restored `topicId`. Release the upload after receiving this result. |
| `exports` | Start `download-chunk({ topicId, format, chunkIndex: 0 })`. Use the returned `downloadId` for subsequent chunks of that snapshot. Supported formats are `archive-zip`, `standalone-html`, and `markdown-bundle`. Release the download after assembly. |
| `events/since` | `{ cursor, topicId? }` returns `{ cursor, events, activeRunCount, truncated }`. Advance using the returned cursor. Refresh cards or the topic tree if older events have expired. |
| `codexhost` | `status`, `projects`, `threads`, `harnesses`, and `harness-inspect` provide Host inventory. Inspect with `{ harnessId, cwd?, refresh? }`. Select the project from `projects` and an advertised model from the inspection catalog. |

## Council runs

- Dispatch accepts `round_number`, `round_type`, `target_panelist_ids`, `target_contribution_ids`, `prompt_full`, `prompt_summary`, and `refs`. Critiques and rebuttals continue the panelist’s existing thread. A sequential sub-agenda admits one slot at a time. Completed panelist slots contribute to progress, with one final slot reserved for synthesis.
- Moderator actions use `topicId`. `synthesize-sub-agenda` also takes `subAgendaId`. `conclude-agenda` takes `agendaId` and optional `publishReport`. `generate-report` accepts an optional `agendaId` and `completeTopic` for a final report. `plan-topic` appends the returned agenda plan after validating its dependencies. Moderator actions accept an optional `prompt` and `moderator_config`.
- `council/runs({ topicId })` returns persisted runs. `cancel-run` and `retry-run` take `{ topicId, runId }`. Cancellation of an active thread is asynchronous. A retry has a new run ID and the same discussion slot.
- The Host reads backend settings on activation. Reactivate after changing the data directory, endpoint, token, or default protocol. Open views subscribe to theme and sidebar settings.
- Import creates an archived topic with fresh resource IDs and a first archive snapshot. Historical run links point to the restored resources. An unfinished source turn is recorded as cancelled in the copy, and its original status is retained in `archivedStatus`. Thread handles in the imported roster are historical.

## Storage and verification

The Host IPC thread and the storage/orchestration worker share one process. The worker has a 128 MiB old-space limit. Storage writes stage private files, commit a redo journal, and recover interrupted transactions on open. Report bodies reside in separate files. The local Host credential file is discovered from the Host data root independently of a custom council directory.

The frontend tests mount the production bundles in Shadow DOM and exercise the Desktop sidebar, the Web panel, and chunked transfers. Backend tests validate protocol schemas, Python v1 archive compatibility, storage recovery and a complete council against an in-process HTTP Host. Packaging tests run the pinned registry validator on valid and invalid release fixtures. The binary fixture in `tests/fixtures/python-v1.zip` came from the repository’s Python archive writer.

