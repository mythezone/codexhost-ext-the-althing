import test from "node:test";
import assert from "node:assert/strict";
import { Council, hydrate, toCard } from "../src/backend/domain/council.ts";
import { councilFixture, fixture, dispatch, contribution } from "./helpers.ts";

test("nested creation, ordering, public shapes, roster and input validation", () => {
  const c = councilFixture();
  assert.equal(c.get("agenda", "a").code, "A1");
  assert.equal(c.get("sub_agenda", "s2").code, "A1.2");
  const a = c.create("agenda", { title: "First", order_index: -1 }, "study");
  assert.equal(hydrate(c.tree).agendas[0].id, a.id);
  for (const data of [
    { id: ".." },
    { id: "a/b" },
    { id: "a".repeat(97) },
    { title: "" },
    { title: "a".repeat(501) },
    { status: "gone" },
    { progress_pct: Infinity },
    { progress_pct: 101 },
    { panelists: [fixture.panelists[0], fixture.panelists[0]] },
    { protocol_id: "missing" },
    { extra: true },
  ]) {
    assert.throws(() => new Council().create("topic", { ...fixture, ...data }));
  }
  const t = hydrate(c.tree);
  assert.equal(JSON.stringify(t).includes('"_progress"'), false);
  assert.deepEqual(t.pinned_fields, []);
  assert.equal(t.agendas[1].sub_agendas.length, 2);
});
test("equal-weight rollup uses half-even rounding at each level and releases all pins", () => {
  const c = councilFixture();
  c.create(
    "agenda",
    {
      id: "b",
      title: "Second",
      sub_agendas: [{ title: "Done", status: "completed" }],
    },
    "study",
  );
  c.patch("sub_agenda", "s", {
    status: "in_progress",
    progress_pct: 1,
    current_activity: "Reviewing",
  });
  assert.equal(c.get("agenda", "a").progress_pct, 0);
  assert.equal(c.tree.progress_pct, 50);
  assert.equal(c.tree.current_activity, "Evidence / Reviewing");
  c.patch("agenda", "a", {
    status: "critiquing",
    progress_pct: 23,
    current_activity: "Pinned agenda",
  });
  c.patch("topic", "study", {
    progress_pct: 7,
    current_activity: "Pinned topic",
  });
  c.patch("sub_agenda", "s", { status: "completed" });
  c.patch("sub_agenda", "s2", { status: "completed" });
  assert.equal(c.tree.progress_pct, 7);
  assert.equal(c.tree.current_activity, "Pinned topic");
  assert.deepEqual(hydrate(c.tree).agendas[0].pinned_fields, [
    "progress_pct",
    "current_activity",
    "status",
  ]);
  c.patch("topic", "study", { progress_pct: null, current_activity: "" });
  c.patch("agenda", "a", {
    status: null,
    current_activity: null,
    progress_pct: "",
  });
  assert.equal(c.tree.progress_pct, 100);
  assert.equal(c.get("agenda", "a").status, "completed");
  assert.ok(c.get("agenda", "a").completed_at);
  assert.deepEqual(hydrate(c.tree).pinned_fields, []);
  c.patch("sub_agenda", "s", { status: "pending" });
  assert.equal(c.get("agenda", "a").completed_at, null);
});
test("dependency graph supports forward references and rejects cycles and foreign IDs", () => {
  const data = {
    title: "T",
    agendas: [
      {
        title: "A",
        sub_agendas: [
          { id: "one", title: "1", depends_on: ["two"] },
          { id: "two", title: "2" },
        ],
      },
    ],
  };
  const c = new Council();
  c.create("topic", data);
  for (const deps of [["one"], ["two"], ["other-topic"]])
    assert.throws(() =>
      new Council(structuredClone(c.tree)).patch("sub_agenda", "two", {
        depends_on: deps,
      }),
    );
  assert.throws(() =>
    c.create("agenda", { id: "one", title: "Duplicate" }, c.tree.id),
  );
});
test("round, attribution, target membership, immutability and roster deletion guards", () => {
  const base = councilFixture();
  base.create("dispatch", dispatch, "s");
  const r = base.create("contribution", contribution, "s");
  assert.deepEqual(
    [r.panelist_name, r.model, r.provider, r.role, r.reasoning_effort],
    ["One", "model", "codex", "Reviewer", "high"],
  );
  const clone = () => new Council(structuredClone(base.tree));
  for (const patch of [
    { full_content: "x" },
    { round_number: 2 },
    { panelist_id: "p2" },
    { id: "new" },
  ])
    assert.throws(() => clone().patch("contribution", "c", patch));
  for (const [data, sub] of [
    [{ round_number: 2 }, "s"],
    [{ panelist_id: "absent" }, "s"],
    [{ target_contribution_ids: ["absent"] }, "s"],
    [{ target_contribution_ids: ["reply"] }, "s"],
    [{}, "s2"],
    [{ round_number: 0 }, "s"],
    [{ kind: "fake" }, "s"],
  ] as const) {
    assert.throws(() =>
      clone().create(
        "contribution",
        { ...contribution, id: "reply", ...data },
        sub,
      ),
    );
  }
  assert.throws(() =>
    clone().create(
      "dispatch",
      { ...dispatch, id: "bad", target_panelist_ids: ["absent"] },
      "s",
    ),
  );
  assert.throws(() => clone().patch("topic", "study", { panelists: [] }));
  base.patch("contribution", "c", {
    summary: "New",
    key_points: ["One"],
    stance_tags: ["uncertain"],
  });
  base.create(
    "contribution",
    {
      ...contribution,
      id: "reply",
      kind: "critique",
      target_contribution_ids: ["c"],
    },
    "s",
  );
  const t = hydrate(base.tree);
  assert.equal(
    t.agendas[0].sub_agendas[0].dispatches[0].contributions.length,
    2,
  );
  assert.equal(t.contribution_count, 2);
  assert.ok(!("agendas" in toCard(base.tree)));
});
test("primary reports respect scope and format, independent report reads", () => {
  const c = councilFixture();
  const r = c.create(
    "report",
    { title: "First", markdown_content: "# Finding", agenda_id: "a" },
    "study",
  );
  assert.equal(c.get("agenda", "a").report_id, r.id);
  assert.throws(() => c.patch("topic", "study", { final_report_id: r.id }));
  for (const data of [
    { title: "Blank" },
    { title: "A", markdown_content: "x", report_type: "agenda" },
    { title: "A", html_content: "x", agenda_id: "foreign" },
  ])
    assert.throws(() => c.create("report", data, "study"));
  const r2 = c.create(
    "report",
    { title: "Final", markdown_content: "x" },
    "study",
  );
  c.create(
    "report",
    { title: "Annex", report_type: "custom", html_content: "Hello" },
    "study",
  );
  assert.equal(c.tree.final_report_id, r2.id);
  assert.ok(!("html_content" in hydrate(c.tree).reports[0]));
  assert.ok(hydrate(c.tree, true).reports[0].html_content);
});
