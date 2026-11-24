import test from "node:test";
import assert from "node:assert/strict";
import {
  isCouncilCommandPrefix,
  parseCouncilCommand,
  splitPrompt,
} from "../src/shared/command.ts";
import {
  classifyDomain,
  detectPromptHints,
  recommendPanel,
} from "../src/backend/smart-panel.ts";
import type { Agent } from "../src/shared/agents.ts";
import { mockHost } from "./mock-host.ts";
import { until } from "./helpers.ts";
import { engine } from "../src/backend/rpc.ts";
import type { Topic } from "../src/backend/domain/models.ts";

function fakeAgent(
  id: string,
  opts: Partial<Agent> = {},
): Agent {
  return {
    id,
    label: id[0].toUpperCase() + id.slice(1),
    section: "delegation",
    configuredForDelegation: true,
    status: "ready",
    statusMessage: "",
    defaultModel: { id: id + "-model" },
    defaultThinking: "high",
    defaultThinkingLabel: "High",
    models: [],
    thinkingOptions: [{ id: "high", label: "High" }],
    ...opts,
  };
}

test("parseCouncilCommand handles single-line, multi-line, flags, bare command, and ignores non-commands", () => {
  assert.equal(parseCouncilCommand("ordinary prompt"), null);
  assert.equal(parseCouncilCommand("/althings test"), null);
  assert.equal(parseCouncilCommand("explain /althing command"), null);

  assert.equal(isCouncilCommandPrefix("/alt"), true);
  assert.equal(isCouncilCommandPrefix("/althing"), true);
  assert.equal(isCouncilCommandPrefix("/althing hi"), false);

  assert.deepEqual(parseCouncilCommand("/althing"), {
    raw: "/althing",
    prompt: "",
    custom: false,
  });
  assert.deepEqual(parseCouncilCommand("/althing  Evaluate Rust sync engine "), {
    raw: "/althing  Evaluate Rust sync engine",
    prompt: "Evaluate Rust sync engine",
    custom: false,
  });
  assert.deepEqual(
    parseCouncilCommand(
      "/althing --debate --experts 4\nSync engine choice\nCompare CRDT and OT on iOS.",
    ),
    {
      raw: "/althing --debate --experts 4\nSync engine choice\nCompare CRDT and OT on iOS.",
      prompt: "Sync engine choice\nCompare CRDT and OT on iOS.",
      protocol: "adversarial-debate",
      expertCount: 4,
      custom: false,
    },
  );
  assert.deepEqual(
    parseCouncilCommand("/althing --custom --rapid Quick check"),
    {
      raw: "/althing --custom --rapid Quick check",
      prompt: "Quick check",
      protocol: "rapid-panel",
      custom: true,
    },
  );

  assert.deepEqual(splitPrompt("Short title"), {
    title: "Short title",
    description: "",
  });
  assert.deepEqual(splitPrompt("Title line\nDetail line 1\nDetail line 2"), {
    title: "Title line",
    description: "Detail line 1\nDetail line 2",
  });
  const long =
    "Should we migrate our offline sync layer from Redux to Zustand? We need lower bundle size, better TypeScript ergonomics, and clean mobile performance across iOS Safari and Desktop.";
  const split = splitPrompt(long);
  assert.ok(split.title.length <= 140);
  assert.equal(split.description, long);
});

test("recommendPanel adapts seat count, harnesses, protocol, and localized roles across agent counts", () => {
  assert.equal(
    detectPromptHints("找4位专家辩论一下是否迁移到 Rust").expertCount,
    4,
  );
  assert.equal(
    detectPromptHints("找4位专家辩论一下是否迁移到 Rust").protocol,
    "adversarial-debate",
  );
  assert.equal(detectPromptHints("3人の専門家で検討").expertCount, 3);
  assert.equal(detectPromptHints("4명의 전문가 의견").expertCount, 4);
  assert.equal(
    detectPromptHints("Quick review of our API schema").protocol,
    "rapid-panel",
  );
  assert.equal(
    classifyDomain("Should we redesign onboarding UX and pricing?", "council-standard"),
    "product",
  );

  const empty = recommendPanel({
    prompt: "Test",
    agents: [fakeAgent("codex", { status: "unavailable" })],
    locale: "en",
  });
  assert.equal(empty.readyCount, 0);
  assert.equal(empty.panelists.length, 0);

  const single = recommendPanel({
    prompt: "Evaluate our backend database caching architecture",
    agents: [fakeAgent("codex")],
    locale: "en",
  });
  assert.equal(single.seatCount, 2);
  assert.equal(single.domain, "engineering");
  assert.notEqual(single.panelists[0].name, single.panelists[1].name);
  assert.match(single.panelists[0].role, /architect/i);

  const twoDebate = recommendPanel({
    prompt: "Debate whether to open-source the SDK",
    agents: [fakeAgent("codex"), fakeAgent("claude-code", { label: "Claude Code" })],
    locale: "zh-CN",
  });
  assert.equal(twoDebate.protocol, "adversarial-debate");
  assert.equal(twoDebate.seatCount, 3);
  assert.equal(twoDebate.panelists[0].role, "正方主辩");
  assert.equal(twoDebate.panelists[1].role, "反方主辩");
  assert.equal(twoDebate.panelists[2].role, "证据与风险审查");

  const fiveAgents = [
    fakeAgent("codex"),
    fakeAgent("claude-code", { label: "Claude Code" }),
    fakeAgent("antigravity"),
    fakeAgent("grok"),
    fakeAgent("other", { configuredForDelegation: false }),
  ];
  const standard = recommendPanel({
    prompt: "Evaluate API caching strategy",
    agents: fiveAgents,
    locale: "en",
  });
  assert.equal(standard.seatCount, 3);
  assert.deepEqual(
    standard.panelists.map((p) => p.provider),
    ["codex", "claude-code", "antigravity"],
  );

  const complex = recommendPanel({
    prompt:
      "Evaluate next-gen multi-agent sync architecture\nCompare CRDT vs op-log across iOS offline mode, bandwidth overhead, security boundaries, and plugin maintainability.",
    agents: fiveAgents,
    locale: "ja",
  });
  assert.equal(complex.seatCount, 4);
  assert.deepEqual(
    complex.panelists.map((p) => p.provider),
    ["codex", "claude-code", "antigravity", "grok"],
  );
  assert.equal(complex.panelists[0].role, "システムアーキテクト");
});

test("council/convene refines roles from AI plan and auto-dispatches Round 1 on first runnable sub-agenda", async (t) => {
  const host = await mockHost(t);
  const backend = await engine(host.dataDir, {});
  t.after(() => backend.dispose());

  const convened = (await backend.call("council/convene", {
    prompt: "Sync engine architecture\nCompare CRDT vs operational logs.",
    locale: "en",
  })) as { topic: Topic; planRun: { id: string } };

  assert.equal(convened.topic.title, "Sync engine architecture");
  assert.equal(convened.topic.description, "Compare CRDT vs operational logs.");
  assert.equal(convened.topic.panelists.length, 2);
  assert.ok(convened.planRun?.id);

  await until(() => host.threads.size === 1, Boolean, 5000);
  const planThread = [...host.threads.keys()][0];
  const planRequest = host.routes("delegate/start")[0].body;
  assert.match(String(planRequest.task), /panelist_roles/);

  const [seatA, seatB] = convened.topic.panelists;
  host.finish(
    planThread,
    JSON.stringify({
      subtitle: "Evaluating offline sync guarantees",
      domain_tags: ["Sync", "Architecture"],
      panelist_roles: [
        { id: seatA.id, role: "CRDT & distributed state specialist" },
        { id: seatB.id, role: "Offline mobile failure-mode skeptic" },
      ],
      agendas: [
        {
          id: "ag-1",
          title: "State convergence",
          sub_agendas: [
            {
              id: "sub-2",
              title: "Final synthesis prep",
              depends_on: ["sub-1"],
            },
            {
              id: "sub-1",
              title: "Conflict semantics",
              depends_on: [],
            },
          ],
        },
      ],
    }),
  );

  // Wait for plan ingestion + automatic Round 1 dispatch (1 plan + 2 panelists = 3 threads).
  await until(() => host.threads.size === 3, Boolean, 8000);
  const updated = (await backend.call("topics/get", {
    topicId: convened.topic.id,
  })) as Topic;
  assert.equal(updated.subtitle, "Evaluating offline sync guarantees");
  assert.deepEqual(updated.domain_tags, ["Sync", "Architecture"]);
  assert.equal(updated.panelists[0].role, "CRDT & distributed state specialist");
  assert.equal(updated.panelists[1].role, "Offline mobile failure-mode skeptic");
  assert.equal(updated.panelists[0].provider, seatA.provider);
  const sub1 = updated.agendas[0].sub_agendas.find((s) => s.id === "sub-1")!;
  const sub2 = updated.agendas[0].sub_agendas.find((s) => s.id === "sub-2")!;
  assert.equal(sub1.dispatches.length, 1);
  assert.equal(sub1.dispatches[0].round_type, "opening");
  assert.equal(sub2.dispatches.length, 0);
});

test("council/set-auto-dispatch(false) pauses automatic Round 1 dispatch cleanly", async (t) => {
  const host = await mockHost(t);
  const backend = await engine(host.dataDir, {});
  t.after(() => backend.dispose());

  const convened = (await backend.call("council/convene", {
    prompt: "Paused auto-dispatch test",
    locale: "en",
  })) as { topic: Topic };
  await until(() => host.threads.size === 1, Boolean, 5000);

  await backend.call("council/set-auto-dispatch", {
    topicId: convened.topic.id,
    enabled: false,
  });

  host.finish(
    [...host.threads.keys()][0],
    JSON.stringify({
      agendas: [
        { title: "Review", sub_agendas: [{ title: "Initial check" }] },
      ],
    }),
  );

  const updated = await until(
    () =>
      backend.call("topics/get", { topicId: convened.topic.id }) as Promise<Topic>,
    (topic) => topic.agendas.length === 1,
    8000,
  );
  assert.equal(updated.agendas[0].sub_agendas[0].dispatches.length, 0);
  assert.equal(host.threads.size, 1);
});
