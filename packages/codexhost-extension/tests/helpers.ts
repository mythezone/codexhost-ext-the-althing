import { mkdtemp, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { Council } from "../src/backend/domain/council.ts";
export const fixture = {
  id: "study",
  title: "Research council",
  subtitle: "Independent review",
  description: "Field evidence",
  domain_tags: ["science"],
  moderator: { name: "Chair", provider: "codex" },
  panelists: [
    {
      id: "p1",
      name: "One",
      role: "Reviewer",
      model: "model",
      provider: "codex",
      reasoning_effort: "high",
    },
    { id: "p2", name: "Two", role: "Analyst", provider: "other" },
  ],
  metadata: {
    codexhost: { project_cwd: "/projects/study", project_label: "Study" },
  },
  agendas: [
    {
      id: "a",
      title: "Evidence",
      sub_agendas: [
        { id: "s", title: "Replication" },
        { id: "s2", title: "Comparison" },
      ],
    },
  ],
};
export function councilFixture() {
  const c = new Council();
  c.create("topic", fixture);
  return c;
}
export const dispatch = {
  id: "d",
  title: "Opening",
  prompt_summary: "Research",
  prompt_full: "Review the evidence",
  target_panelist_ids: ["p1"],
};
export const contribution = {
  id: "c",
  panelist_id: "p1",
  dispatch_id: "d",
  summary: "Lead",
  full_content: "Full account",
};
export async function temp(t: TestContext) {
  const p = await mkdtemp(path.join(await realpath(tmpdir()), "althing-"));
  t.after(() => rm(p, { recursive: true, force: true }));
  return p;
}
export async function until<T>(
  read: () => T | Promise<T>,
  ok: (v: T) => boolean,
  ms = 8000,
) {
  const end = Date.now() + ms;
  let value = await read();
  while (!ok(value) && Date.now() < end) {
    await delay(12);
    value = await read();
  }
  assert.ok(
    ok(value),
    "Timed out waiting for " + JSON.stringify(value).slice(-1400),
  );
  return value;
}
