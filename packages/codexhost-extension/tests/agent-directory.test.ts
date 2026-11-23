import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { writeFile } from "node:fs/promises";
import { mockHost } from "./mock-host";
import { engine } from "../src/backend/rpc";
import { CodexHostBridge } from "../src/backend/codexhost-bridge";
import { modelLabel, thinkingFor } from "../src/shared/agents";
import { fixture, dispatch, contribution } from "./helpers";

test("agent inventory uses collaboration settings, safe errors, current model refs, caching and per-model thinking", async (t) => {
  const host = await mockHost(t),
    bridge = new CodexHostBridge({ dataDir: host.dataDir });
  t.after(() => bridge.dispose());
  const encode = (s: string) =>
    "cursor." + Buffer.from(s).toString("base64url");
  const current = encode("grok[fast=false]"),
    old = encode("grok");
  const ready = (catalog: object) => ({ status: "ready", catalog });
  host.options.inspections = {
    "cursor-cli": ready({
      models: [
        { ref: { id: "auto" }, label: "Auto", supportedThinkingOptionIds: [] },
        {
          ref: { id: current },
          fastModel: { id: encode("grok[fast=true]") },
          label: "Grok",
          supportedThinkingOptionIds: ["exact"],
        },
        { ref: { id: "other" }, supportedThinkingOptionIds: ["other-high"] },
      ],
      thinkingOptions: [
        { id: "exact", label: "Extra High" },
        { id: "other-high", label: "Extra High" },
      ],
    }),
    codex: ready({
      models: [
        { ref: { id: "slow" } },
        { ref: { id: "best" }, supportedThinkingOptionIds: ["high", "ultra"] },
      ],
      defaultModel: { id: "slow" },
      defaultThinkingOptionId: "high",
    }),
    "claude-code": ready({
      models: [
        {
          ref: { id: "default" },
          label: "Default",
          resolvedModelLabel: "Claude",
        },
      ],
    }),
    missing: { status: "notInstalled", error: { code: "notInstalled" } },
    locked: {
      status: "error",
      error: {
        code: "authenticationRequired",
        message: "Sign in first",
        retryable: false,
      },
    },
  };
  const prefs = path.join(host.root, "harness-preferences-v1.json");
  const initial = await bridge.listAgents("/workspace");
  assert.equal(
    initial.agents.find((a) => a.id === "codex")!.defaultModel!.id,
    "slow",
  );
  await writeFile(
    prefs,
    JSON.stringify({
      scopes: {
        external: {
          delegation: {
            byHarness: {
              codex: {
                model: { id: "best" },
                thinkingOptionId: "ultra",
                private: "omit-me",
              },
              "cursor-cli": { model: { id: old }, thinkingOptionId: "exact" },
            },
          },
          newThread: {
            byHarness: {
              codex: { model: { id: "slow" }, thinkingOptionId: "high" },
              "claude-code": { model: { id: "default" } },
            },
          },
        },
      },
    }),
  );
  await writeFile(
    path.join(host.root, "harness-display-settings-v1.json"),
    JSON.stringify([
      { agent: "codex", section: "main" },
      { agent: "cursor-cli", section: "delegation" },
    ]),
  );
  const count = host.routes("harness/inspect").length;
  await bridge.listAgents("/workspace");
  assert.equal(host.routes("harness/inspect").length, count);
  const [{ agents }, second] = await Promise.all([
    bridge.listAgents("/workspace", true),
    bridge.listAgents("/workspace", true),
  ]);
  assert.deepEqual(second.agents, agents);
  assert.equal(host.routes("harness/inspect").length - count, 5);
  assert.deepEqual(
    agents.slice(0, 3).map((a) => a.id),
    ["codex", "cursor-cli", "claude-code"],
  );
  assert.equal(agents[0].defaultThinking, "ultra");
  assert.deepEqual(
    thinkingFor(agents[0], null).map((o) => o.id),
    ["high", "ultra"],
  );
  assert.equal(agents[1].defaultModel!.id, current);
  assert.deepEqual(thinkingFor(agents[1], null), [
    { id: "exact", label: "Extra High" },
  ]);
  assert.equal(agents[1].defaultThinkingLabel, "Extra High");
  assert.equal(
    modelLabel(agents[2], agents[2].defaultModel),
    "Default (Claude)",
  );
  assert.equal(
    agents.find((a) => a.id === "locked")!.statusMessage,
    "Sign in first",
  );
  assert.equal(agents.find((a) => a.id === "missing")!.status, "notInstalled");
  assert.ok(!JSON.stringify(agents).includes("omit-me"));
  await writeFile(prefs, "invalid");
  assert.ok(
    (await bridge.listAgents("/other")).agents.every(
      (a) => !a.configuredForDelegation,
    ),
  );
});
test("roster changes atomically retain matching threads, reset changed assignments and preserve historical attribution", async (t) => {
  const h = await mockHost(t),
    api = await engine(h.dataDir, {});
  t.after(() => api.dispose());
  const cfg = {
    harnessId: "codex",
    model: { id: "model" },
    thinking: "high",
    threadId: "original",
  };
  await api.call("topics/create", {
    data: {
      ...fixture,
      metadata: {
        extra: "keep",
        codexhost: {
          ...fixture.metadata.codexhost,
          panelist_threads: { p1: cfg, p2: cfg },
          moderator_config: cfg,
        },
      },
    },
  });
  const call = (method: string, p: object) =>
    api.call(method, { topicId: "study", ...p });
  await call("dispatches/create", { subAgendaId: "s", data: dispatch });
  await call("contributions/create", { subAgendaId: "s", data: contribution });
  const patch = {
    panelists: fixture.panelists.map((p) => ({ ...p, role: "Designer" })),
    metadata: {
      codexhost: {
        panelist_threads: {
          p1: { ...cfg, threadId: null },
          p2: { ...cfg, thinking: "low" },
        },
        moderator_config: { ...cfg, model: { id: "other" } },
        moderator_display: { role: "Chair", reasoning_effort: "High" },
      },
    },
  };
  const updated: any = await call("topics/update", { patch });
  assert.equal(updated.metadata.extra, "keep");
  assert.equal(
    updated.metadata.codexhost.panelist_threads.p1.threadId,
    "original",
  );
  assert.equal(updated.metadata.codexhost.panelist_threads.p2.threadId, null);
  assert.equal(updated.metadata.codexhost.moderator_config.threadId, null);
  assert.equal(
    updated.agendas[0].sub_agendas[0].contributions[0].role,
    "Reviewer",
  );
  await assert.rejects(
    call("topics/update", { patch: { ...patch, panelists: [] } }),
    /Keep panelists/,
  );
  assert.equal(((await call("topics/get", {})) as any).panelists.length, 2);
});
