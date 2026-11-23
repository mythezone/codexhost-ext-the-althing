# The Althing · 议事厅

A CodexHost v2 extension for running multi-agent research councils. Choose a project and expert panel, read agenda conclusions and follow discussions by round, then export the report and archive.

## Install and update

Download `the-althing.zip` from the [latest release](https://github.com/mythezone/codexhost-ext-the-althing/releases/latest). In CodexHost's extension manager, import the ZIP and enable The Althing. For GitHub-sourced updates, use `mythezone/codexhost-ext-the-althing` and the release asset `the-althing.zip`, leaving the tag empty to follow stable releases.

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
