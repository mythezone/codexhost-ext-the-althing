import test from "node:test";
import assert from "node:assert/strict";
import { writeFile, chmod, rename, symlink, readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { CodexHostBridge } from "../src/backend/codexhost-bridge.ts";
import { Orchestrator } from "../src/backend/orchestrator.ts";
import { Store } from "../src/backend/storage.ts";
import { fixture, until } from "./helpers.ts";
import { mockHost } from "./mock-host.ts";
import type { TestContext } from "node:test";

const answer =
  "Evidence supports the first result.\n\n- First observation\n- Second observation\n- Third observation\n\nStance tags: empirical, uncertain\n";
async function setup(t: TestContext, sequential = false) {
  const host = await mockHost(t);
  const store = await Store.open(host.dataDir);
  await store.transaction(null, (c) => {
    c.create("topic", fixture);
    if (sequential)
      c.patch("sub_agenda", "s", { execution_mode: "sequential" });
  });
  const make = () => new Orchestrator(store, new CodexHostBridge(host), 35);
  const o = make();
  await o.resume();
  return {
    host,
    store,
    o,
    make,
    wait: (id: string, status: string) =>
      until(
        () => o.runs("study"),
        (runs) => runs.find((r) => r.id === id)?.status === status,
      ),
  };
}
test("Host credentials, rotation and wire contracts including catalog-aware model refs", async (t) => {
  const h = await mockHost(t),
    b = new CodexHostBridge(h);
  assert.ok((await b.getStatus()).connected);
  await h.rotate();
  assert.equal((await b.getHostInfo()).id, "host");
  assert.equal(h.unauthorized, 1);
  await b.listProjects({ query: "Study" });
  await b.listHarnesses();
  await b.inspectHarness("other", "/p", true);
  await b.listThreads({ limit: 4 });
  for (const model of [
    "model~fast",
    "model~ultrafast",
    "literal~fast",
    { id: "direct", serviceTier: "ultrafast" as const },
  ]) {
    await b.delegateStart({
      harness: "codex",
      cwd: "/p",
      task: "Review",
      model,
      thinking: "high",
      taskName: "T",
      refs: ["https://example.org"],
    });
  }
  const starts = h.routes("delegate/start");
  assert.deepEqual(
    starts.map((s) => s.body.model),
    [
      { id: "model", serviceTier: "priority" },
      { id: "model", serviceTier: "ultrafast" },
      { id: "literal~fast" },
      { id: "direct", serviceTier: "ultrafast" },
    ],
  );
  assert.ok(
    starts.every(
      (s) =>
        s.body.watch &&
        s.body.thinkingOptionId === "high" &&
        !Object.hasOwn(s.body, "thinking"),
    ),
  );
  const tid = [...h.threads.keys()][0];
  await b.readThread(tid, "messages", 1, 2);
  await b.sendThread(tid, "Continue");
  await b.cancelThread(tid);
  assert.equal(h.routes("thread/read")[0].body.to, 2);
  const file = JSON.parse(await readFile(h.credPath, "utf8"));
  for (const patch of [
    { endpoint: "http://example.org" },
    { pid: -1 },
    { schemaVersion: 2 },
    { token: "short" },
  ]) {
    await writeFile(h.credPath, JSON.stringify({ ...file, ...patch }));
    assert.equal((await new CodexHostBridge(h).getStatus()).connected, false);
  }
  await h.rotate();
  await chmod(h.credPath, 0o644);
  assert.equal((await new CodexHostBridge(h).getStatus()).connected, false);
  const override = new CodexHostBridge(h, {
    externalEndpoint: h.endpoint,
    clientToken: h.token,
  });
  assert.ok((await override.getStatus()).connected);
  await chmod(h.credPath, 0o600);
  await rename(h.credPath, h.credPath + ".target");
  await symlink(h.credPath + ".target", h.credPath);
  assert.equal((await new CodexHostBridge(h).getStatus()).connected, false);
  b.dispose();
  override.dispose();
});
test("parallel opening, persisted progress, message fallback, thread continuation, synthesis and reports", async (t) => {
  const { host, store, o, wait } = await setup(t);
  try {
    const { runs, dispatch } = await o.dispatchRound("study", "s", {});
    await until(
      () => host.threads.size,
      (n) => n === 2,
    );
    await until(
      () => o.runs("study"),
      (rs) => rs.every((r) => !!r.threadId && !!r.progressText),
    );
    let live = await o.runs("study");
    assert.equal(
      (await store.load("study")).agendas[0].sub_agendas[0].current_activity,
      "Reviewing evidence",
    );
    host.finish(live[0].threadId!, answer, true);
    host.finish(live[1].threadId!, answer);
    await wait(runs[1].id, "completed");
    await wait(runs[0].id, "completed");
    const sub = (await store.load("study")).agendas[0].sub_agendas[0];
    assert.equal(sub.progress_pct, 67);
    assert.equal(sub.contributions.length, 2);
    assert.ok(
      sub.contributions.every(
        (c) =>
          c.dispatch_id === dispatch.id &&
          c.duration_ms! >= 0 &&
          c.full_content === answer &&
          c.key_points.length === 3,
      ),
    );
    assert.deepEqual(sub.contributions[0].stance_tags, [
      "empirical",
      "uncertain",
    ]);
    for (const round of ["critique", "rebuttal"]) {
      const d = await o.dispatchRound("study", "s", {
        round_type: round,
        target_panelist_ids: ["p1"],
        target_contribution_ids: [sub.contributions[1].id],
      });
      const calls = await until(
        () => host.routes("thread/send"),
        (rs) => rs.length === (round === "critique" ? 1 : 2),
      );
      assert.match(
        String(calls.at(-1)!.body.message),
        new RegExp(sub.contributions[1].id),
      );
      assert.equal(calls.at(-1)!.body.threadId, live[0].threadId);
      host.finish(live[0].threadId!, answer);
      await wait(d.runs[0].id, "completed");
      const con = (
        await store.load("study")
      ).agendas[0].sub_agendas[0].contributions.at(-1)!;
      assert.equal(con.kind, round);
      assert.deepEqual(con.target_contribution_ids, [sub.contributions[1].id]);
    }
    for (const [kind, params, body] of [
      ["synthesis", { subAgendaId: "s" }, "Supported consensus."],
      [
        "agenda_conclusion",
        { agendaId: "a", publishReport: true },
        JSON.stringify({
          conclusion_summary: "Adequate evidence",
          conclusion_key_points: ["A"],
          open_disagreements: ["B"],
        }),
      ],
      ["report", { completeTopic: true }, answer],
      [
        "plan",
        {},
        JSON.stringify({
          agendas: [
            { title: "Follow-up", sub_agendas: [{ title: "New analysis" }] },
          ],
        }),
      ],
    ] as const) {
      const r = await o.moderate(kind, "study", params);
      const x = await until(
        () => o.runs("study"),
        (rs) => !!rs.find((v) => v.id === r.id)?.threadId,
      );
      host.finish(x.find((v) => v.id === r.id)!.threadId!, body);
      await wait(r.id, "completed");
    }
    const tree = await store.load("study");
    assert.equal(
      tree.agendas[0].sub_agendas[0].synthesis_summary,
      "Supported consensus.",
    );
    assert.equal(tree.agendas[0].sub_agendas[0].status, "completed");
    assert.deepEqual(tree.agendas[0].open_disagreements, ["B"]);
    assert.ok(tree.agendas[0].report_id);
    assert.ok(tree.final_report_id);
    assert.equal(tree.status, "completed");
    assert.equal(tree.reports.length, 2);
    assert.equal(tree.agendas[1].title, "Follow-up");
    assert.equal(tree.key_takeaways.length, 3);
  } finally {
    await o.dispose();
  }
});
test("sequential order, failure, cancellation and retry preserve a single outstanding slot", async (t) => {
  const { host, store, o, wait } = await setup(t, true);
  try {
    const { runs } = await o.dispatchRound("study", "s", {});
    await until(
      () => host.threads.size,
      (n) => n === 1,
    );
    await delay(100);
    assert.equal(host.threads.size, 1);
    const first = [...host.threads.values()][0];
    first.status = "failed";
    await wait(runs[0].id, "failed");
    assert.match((await o.runs("study"))[0].error!, /Harness exited/);
    await until(
      () => host.threads.size,
      (n) => n === 2,
    );
    await o.cancel("study", runs[1].id);
    await wait(runs[1].id, "cancelled");
    assert.equal(host.routes("thread/cancel").length, 1);
    const before = (await store.load("study")).agendas[0].sub_agendas[0];
    assert.equal(before.contributions.length, 0);
    assert.equal(before.progress_pct, 0);
    await assert.rejects(
      o.moderate("synthesis", "study", { subAgendaId: "s" }),
      /Outstanding/,
    );
    const r = await o.retry("study", runs[0].id);
    await assert.rejects(o.retry("study", runs[0].id));
    const live = await until(
      () => o.runs("study"),
      (rs) => !!rs.find((x) => x.id === r.id)?.threadId,
    );
    host.finish(live.find((x) => x.id === r.id)!.threadId!, answer);
    await wait(r.id, "completed");
    const after = (await store.load("study")).agendas[0].sub_agendas[0];
    assert.equal(after.contributions.length, 1);
    assert.equal(after.progress_pct, 33);
  } finally {
    await o.dispose();
  }
});
test("restart resumes polling durable thread IDs, ingests once and dispose stops polling", async (t) => {
  const { host, store, o, make } = await setup(t);
  const r = (
    await o.dispatchRound("study", "s", { target_panelist_ids: ["p1"] })
  ).runs[0];
  const live = await until(
    () => o.runs("study"),
    (rs) => !!rs[0].threadId,
  );
  await o.dispose();
  const reads = host.reads;
  await delay(125);
  assert.equal(host.reads, reads);
  host.finish(live[0].threadId!, answer);
  const resumed = make();
  try {
    await resumed.resume();
    await until(
      () => resumed.runs("study"),
      (rs) => rs[0].id === r.id && rs[0].status === "completed",
    );
    assert.equal(host.routes("delegate/start").length, 1);
    assert.equal(
      (await store.load("study")).agendas[0].sub_agendas[0].contributions
        .length,
      1,
    );
    await delay(180);
    const idle = host.reads;
    await delay(100);
    assert.equal(host.reads, idle);
  } finally {
    await resumed.dispose();
  }
});
test("cached credentials recover when a restarted Host moves to another port", async (t) => {
  const first = await mockHost(t),
    bridge = new CodexHostBridge(first);
  assert.ok((await bridge.getStatus()).connected);
  const second = await mockHost(t);
  await writeFile(first.credPath, await readFile(second.credPath));
  await first.stop();
  try {
    assert.equal((await bridge.getHostInfo()).id, "host");
    assert.equal(second.routes("host/info").length, 1);
  } finally {
    bridge.dispose();
  }
});
test("a continued Thread cannot republish the previous turn or a user message", async (t) => {
  const { host, store, o, wait } = await setup(t);
  try {
    const opening = (
      await o.dispatchRound("study", "s", { target_panelist_ids: ["p1"] })
    ).runs[0];
    const first = await until(
      () => o.runs("study"),
      (rs) => !!rs[0].threadId,
    );
    const thread = host.threads.get(first[0].threadId!)!;
    const oldTurn = thread.turnId;
    host.finish(thread.threadId, answer);
    await wait(opening.id, "completed");
    const critique = (
      await o.dispatchRound("study", "s", {
        round_type: "critique",
        target_panelist_ids: ["p1"],
      })
    ).runs[0];
    await until(
      () => host.routes("thread/send").length,
      (n) => n === 1,
    );
    const newTurn = thread.turnId;
    Object.assign(thread, {
      turnId: oldTurn,
      status: "completed",
      output: answer,
    });
    await delay(125);
    assert.equal((await o.runs("study")).at(-1)!.status, "running");
    Object.assign(thread, {
      turnId: newTurn,
      status: "completed",
      output: "",
      final: "",
    });
    await wait(critique.id, "failed");
    assert.match(
      (await o.runs("study")).at(-1)!.error!,
      /without a final response/,
    );
    assert.equal(
      (await store.load("study")).agendas[0].sub_agendas[0].contributions
        .length,
      1,
    );
  } finally {
    await o.dispose();
  }
});

test("workspace inventory merges project roots, default and recent local paths before filtering", async (t) => {
  const h = await mockHost(t),
    b = new CodexHostBridge(h);
  h.options.defaultWorkspace = "/projects/study/";
  h.options.threadCwds = [
    "/projects/study",
    "/projects/recent",
    "",
    "C:\\Data\\Lab",
    "c:\\data\\lab",
  ];
  try {
    const all = await b.workspaces();
    assert.deepEqual(
      all.projects.map((p) => p.name),
      ["Study", "recent", "Lab"],
    );
    assert.ok(h.routes("thread/list").some((r) => r.body.limit === 100));
    h.options.emptyProjects = true;
    const merged = await b.workspaces();
    assert.equal(merged.total, 3);
    assert.equal(merged.projects[0].cwd, "/projects/study/");
    assert.deepEqual(
      (await b.workspaces({ query: "recent" })).projects.map((p) => p.cwd),
      ["/projects/recent"],
    );
  } finally {
    b.dispose();
  }
});
