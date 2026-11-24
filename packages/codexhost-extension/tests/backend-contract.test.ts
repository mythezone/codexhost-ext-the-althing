import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { readFile, readdir, stat } from "node:fs/promises";
import { randomBytes, createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { TestContext } from "node:test";
import { mockHost } from "./mock-host.ts";
import { fixture, until, councilFixture, temp } from "./helpers.ts";
import { archiveZip } from "../src/backend/domain/archives.ts";
import { hydrate } from "../src/backend/domain/council.ts";
import { readZip, writeZip, MAX_BYTES } from "../src/backend/domain/zip.ts";
import { CHUNK } from "../src/backend/storage.ts";
import capSchema from "../../protocol/capabilities.schema.json" with { type: "json" };
import manifest from "../manifest.json" with { type: "json" };

const root = fileURLToPath(new URL("../", import.meta.url));
function checkJSON(v: unknown) {
  const bytes = JSON.stringify(v, (_k, x) => {
    assert.ok(x !== undefined && !["function", "symbol"].includes(typeof x));
    if (typeof x === "number") assert.ok(Number.isFinite(x));
    return x;
  });
  assert.ok(Buffer.byteLength(bytes) < 2 * 1024 * 1024 - 1024);
}
async function activate(
  dataDir: string,
  settings: Record<string, unknown> = {},
) {
  const entry = await import(
    new URL("../dist/backend/index.mjs", import.meta.url).href
  );
  const handlers = new Map<string, (p: unknown) => Promise<any>>(),
    seen = new Set<string>();
  const handle = await entry.activate({
    extensionId: "the-althing",
    extensionDir: root,
    dataDir,
    readSettings: async () => settings,
    handle: (name: string, handler: (p: unknown) => Promise<unknown>) => {
      assert.ok(!handlers.has(name));
      handlers.set(name, handler);
    },
  });
  async function raw(method: string, p: unknown = {}) {
    checkJSON(p);
    seen.add(method);
    const begin = performance.now();
    const value = await handlers.get("althing/" + method)!(p);
    assert.ok(performance.now() - begin < 3000, method + " stalled");
    checkJSON(value);
    return value;
  }
  async function call(method: string, p: unknown = {}) {
    let result = await raw(method, p);
    while (result?.status === "pending" && result.operationId) {
      await delay(20);
      result = await raw("operations/get", { operationId: result.operationId });
    }
    return result;
  }
  return { handlers, seen, raw, call, dispose: () => handle.dispose() };
}
test("bundle size and registry patterns over source and built modules", async () => {
  const st = await stat(path.join(root, "dist", manifest.backend.entry));
  assert.ok(st.size > 0 && st.size < 2 * 1024 * 1024);
  assert.deepEqual(
    [manifest.manifestVersion, manifest.id, manifest.author],
    [2, "the-althing", "mythezone"],
  );
  assert.equal("slots" in manifest, false);
  assert.ok(manifest.desktop.script.endsWith(".js"));
  for (const dir of ["src", "dist"]) {
    for (const rel of await readdir(path.join(root, dir), { recursive: true }))
      if (/\.[cm]?[jt]sx?$/u.test(rel)) {
        const source = await readFile(path.join(root, dir, rel), "utf8");
        for (const pattern of [
          /\beval\s*\(/u,
          /\bnew\s+Function\b/u,
          new RegExp("\\bchild_" + "process\\b", "u"),
        ])
          assert.doesNotMatch(source, pattern, rel);
      }
  }
});
test("built entry registers and exercises every RPC, including delegation, archive upload, filtered cards and disposal", async (t) => {
  const host = await mockHost(t),
    b = await activate(host.dataDir, {
      defaultProtocol: "rapid-panel",
      dataDir: path.join(host.root, "custom"),
    });
  const call = b.call;
  try {
    const cap = await call("capabilities");
    assert.ok(new Ajv2020({ strict: false }).validate(capSchema, cap));
    assert.equal(cap.auth.write_requires_key, false);
    assert.equal((await call("codexhost/status")).connected, true);
    host.options.infoDelay = 1750;
    const receipt = await b.raw("codexhost/status");
    assert.equal(receipt.status, "pending");
    const delayed = await call("operations/get", {
      operationId: receipt.operationId,
    });
    assert.ok(delayed.connected);
    host.options.infoDelay = 0;
    await call("codexhost/projects");
    await call("codexhost/threads");
    await call("codexhost/harnesses");
    assert.equal((await call("codexhost/agents")).agents.length,2);
    await call("codexhost/harness-inspect", { harnessId: "codex" });
    assert.equal(
      (await call("topics/create", { data: fixture })).protocol_id,
      "rapid-panel",
    );
    const p = { topicId: "study" };
    await call("topics/update", { ...p, patch: { subtitle: "Changed" } });
    await call("topics/get", p);
    assert.equal(
      (
        await call("topics/list", {
          projectCwd: "/projects/study",
          q: "Field",
          tag: "science",
        })
      ).length,
      1,
    );
    await call("agendas/create", { ...p, data: { id: "b", title: "Extra" } });
    await call("agendas/update", {
      ...p,
      agendaId: "b",
      patch: { objective: "Review" },
    });
    await call("sub-agendas/create", {
      ...p,
      agendaId: "b",
      data: { id: "s3", title: "Third" },
    });
    await call("sub-agendas/update", {
      ...p,
      subAgendaId: "s3",
      patch: { prompt_framing: "Question" },
    });
    await call("dispatches/create", {
      ...p,
      subAgendaId: "s3",
      data: {
        id: "manual",
        title: "Round",
        prompt_summary: "Question",
        prompt_full: "Full question",
      },
    });
    await call("contributions/create", {
      ...p,
      subAgendaId: "s3",
      data: {
        id: "manual-response",
        panelist_id: "p1",
        summary: "Summary",
        full_content: "Verbatim",
        dispatch_id: "manual",
      },
    });
    assert.deepEqual(
      await call("topics/body", {
        ...p,
        kind: "contribution",
        resourceId: "manual-response",
      }),
      { text: "Verbatim" },
    );
    assert.deepEqual(
      await call("topics/body", {
        ...p,
        kind: "dispatch",
        resourceId: "manual",
      }),
      { text: "Full question" },
    );
    const full = await call("topics/get", p);
    assert.deepEqual(
      await call("topics/get", { ...p, summaryOnly: false }),
      full,
    );
    assert.equal(JSON.stringify(full).includes("full_content_length"), false);
    await assert.rejects(call("topics/get", { ...p, summaryOnly: "false" }));
    await call("topics/create", {
      data: { id: "unrelated", title: "Unrelated" },
    });
    for (const bad of [
      { ...p, kind: "report", resourceId: "manual" },
      { ...p, kind: "dispatch", resourceId: "manual-response" },
      { ...p, kind: "contribution", resourceId: "../manual-response" },
      {
        topicId: "unrelated",
        kind: "contribution",
        resourceId: "manual-response",
      },
    ])
      await assert.rejects(call("topics/body", bad));
    await call("topics/delete", { topicId: "unrelated" });
    await call("contributions/update", {
      ...p,
      contributionId: "manual-response",
      patch: { summary: "Revised" },
    });
    const report = await call("reports/publish", {
      ...p,
      data: { title: "R", markdown_content: "# R" },
    });
    assert.equal(
      (await call("reports/get", { ...p, reportId: report.id }))
        .markdown_content,
      "# R",
    );
    const archive = await call("archives/create", p);
    assert.equal((await call("archives/list", p)).length, 1);
    const page = await call("archives/download-chunk", {
      ...p,
      archiveId: archive.id,
      chunkIndex: 0,
    });
    const upload = await call("archives/import-begin", {
      totalBytes: page.totalBytes,
    });
    for (let i = 0; i < page.totalChunks; i++) {
      const chunk = i
        ? await call("archives/download-chunk", {
            ...p,
            archiveId: archive.id,
            chunkIndex: i,
          })
        : page;
      await call("archives/import-chunk", {
        uploadId: upload.uploadId,
        chunkIndex: i,
        base64: chunk.base64,
      });
    }
    const restored = await call("archives/import-commit", {
      uploadId: upload.uploadId,
    });
    assert.deepEqual(
      await call("archives/import-commit", { uploadId: upload.uploadId }),
      restored,
    );
    await call("topics/delete", restored);
    await call("transfers/release", { transferId: upload.uploadId });
    for (const format of [
      "standalone-html",
      "markdown-bundle",
      "archive-zip",
    ]) {
      const page = await call("exports/download-chunk", { ...p, format });
      assert.ok(page.base64);
      await call("transfers/release", { transferId: page.downloadId });
    }
    const round = await call("council/dispatch-round", {
      ...p,
      subAgendaId: "s",
      target_panelist_ids: ["p1"],
    });
    const runId = round.runs[0].id;
    await until(
      () => call("council/runs", p),
      (rs) => !!rs[0]?.threadId,
    );
    await call("council/cancel-run", { ...p, runId });
    await until(
      () => call("council/runs", p),
      (rs) => rs[0].status === "cancelled",
    );
    await call("council/retry-run", { ...p, runId });
    await call("council/synthesize-sub-agenda", { ...p, subAgendaId: "s2" });
    await call("council/conclude-agenda", { ...p, agendaId: "a" });
    await call("council/generate-report", p);
    await call("council/plan-topic", p);
    const rec = await call("council/recommend-panel", {
      prompt: "Evaluate caching architecture",
    });
    assert.ok(rec.readyCount >= 1 && rec.panelists.length >= 1);
    const convened = await call("council/convene", {
      prompt: "Quick contract convene",
      planWithAi: false,
    });
    assert.equal(convened.topic.title, "Quick contract convene");
    await call("council/set-auto-dispatch", {
      topicId: convened.topic.id,
      enabled: false,
    });
    await call("topics/delete", { topicId: convened.topic.id });
    assert.ok((await call("events/since", { cursor: 0 })).activeRunCount >= 4);
    await assert.rejects(call("operations/get", { operationId: "unknown" }));
    assert.deepEqual(
      [...b.handlers.keys()].sort(),
      [...b.seen].map((k) => "althing/" + k).sort(),
    );
  } finally {
    await b.dispose();
  }
});
test("large report and topic projections remain readable through bounded JSON chunks", async (t) => {
  const b = await activate(await temp(t));
  try {
    const p = { topicId: "study" };
    await b.call("topics/create", fixture);
    const body = "a".repeat(820000),
      report = await b.call("reports/publish", {
        ...p,
        data: { title: "Large", markdown_content: body },
      });
    const json = await b.call("reports/get", { ...p, reportId: report.id });
    assert.equal(json.encoding, "json");
    const parts: Buffer[] = [];
    let i = 0;
    do {
      const page = await b.call("exports/download-chunk", {
        downloadId: json.downloadId,
        chunkIndex: i++,
      });
      parts.push(Buffer.from(page.base64, "base64"));
      if (i === page.totalChunks) break;
    } while (true);
    assert.equal(
      JSON.parse(Buffer.concat(parts).toString()).markdown_content,
      body,
    );
    assert.ok(!JSON.stringify(await b.call("topics/get", p)).includes(body));
    await b.call("dispatches/create", {
      ...p,
      subAgendaId: "s",
      data: { id: "d", title: "D", prompt_full: "🌙夜", prompt_summary: "?" },
    });
    await b.call("contributions/create", {
      ...p,
      subAgendaId: "s",
      data: {
        dispatch_id: "d",
        panelist_id: "p1",
        summary: "S",
        full_content: body,
      },
    });
    const fullTopic = await b.call("topics/get", p);
    assert.equal(fullTopic.encoding, "json");
    const summary = await b.call("topics/get", { ...p, summaryOnly: true });
    assert.ok(
      Buffer.byteLength(JSON.stringify(summary)) < 0.2 * fullTopic.totalBytes,
    );
    const sub = summary.agendas[0].sub_agendas[0],
      reply = sub.contributions[0],
      task = sub.dispatches[0];
    assert.equal(reply.full_content, "");
    assert.equal(reply.full_content_length, Array.from(body).length);
    assert.deepEqual(task.contribution_ids, [reply.id]);
    assert.ok(!("contributions" in task));
    assert.equal(task.prompt_full, "");
    assert.equal(task.prompt_full_length, 2);
    const content = await b.call("topics/body", {
      ...p,
      kind: "contribution",
      resourceId: reply.id,
    });
    assert.ok(content.encoding === "json" || content.text === body);
    assert.ok(JSON.stringify(await b.call("topics/list")).length < 5000);
  } finally {
    await b.dispose();
  }
});
test("imports an exact 64 MiB portable ZIP through 128 bounded IPC uploads", async (t: TestContext) => {
  const files = readZip(archiveZip(hydrate(councilFixture().tree, true)));
  const other = [...files]
    .filter(([key]) => key !== "README.md")
    .reduce((n, [, b]) => n + b.length, 0);
  const readme = randomBytes(MAX_BYTES - other - 2048);
  files.set("README.md", readme);
  const manifest = JSON.parse(files.get("manifest.json")!.toString());
  manifest.files["README.md"] = createHash("sha256")
    .update(readme)
    .digest("hex");
  files.set("manifest.json", Buffer.from(JSON.stringify(manifest)));
  const bytes = writeZip(files),
    padding = MAX_BYTES - bytes.length;
  assert.ok(padding >= 0 && padding <= 65535);
  bytes.writeUInt16LE(padding, bytes.length - 2);
  const zip = Buffer.concat([bytes, Buffer.alloc(padding)]);
  const b = await activate(await temp(t));
  try {
    const begin = await b.call("archives/import-begin", {
      totalBytes: zip.length,
    });
    assert.equal(begin.totalChunks, 128);
    for (let i = 0; i < begin.totalChunks; i++)
      await b.call("archives/import-chunk", {
        uploadId: begin.uploadId,
        chunkIndex: i,
        base64: zip.subarray(i * CHUNK, (i + 1) * CHUNK).toString("base64"),
      });
    const restored = await b.call("archives/import-commit", {
      uploadId: begin.uploadId,
    });
    assert.equal((await b.call("topics/get", restored)).status, "archived");
    assert.equal((await b.call("archives/list", restored)).length, 1);
  } finally {
    await b.dispose();
  }
});

test("restores nineteen 1 MiB reports under the Host heap limit, with a snapshot", async (t) => {
  const b = await activate(await temp(t)),
    article = "x".repeat(1024 * 1024);
  try {
    const { id: topicId } = await b.call("topics/create", {
      title: "Large council",
    });
    for (let i = 0; i < 19; i++)
      await b.call("reports/publish", {
        topicId,
        data: { title: String(i), markdown_content: article },
      });
    const d = await b.call("exports/download-chunk", {
      topicId,
      format: "archive-zip",
    });
    assert.ok(d.totalChunks > 1);
    const u = await b.call("archives/import-begin", {
      totalBytes: d.totalBytes,
    });
    for (let i = 0; i < d.totalChunks; i++) {
      const chunk =
        i === 0
          ? d
          : await b.call("exports/download-chunk", {
              downloadId: d.downloadId,
              chunkIndex: i,
            });
      await b.call("archives/import-chunk", {
        uploadId: u.uploadId,
        chunkIndex: i,
        base64: chunk.base64,
      });
    }
    const out = await b.call("archives/import-commit", {
      uploadId: u.uploadId,
    });
    const tree = await b.call("topics/get", out);
    assert.equal(tree.report_count, 19);
    assert.equal(tree.archive_count, 1);
    for (const r of tree.reports) {
      const descriptor = await b.call("reports/get", {
        ...out,
        reportId: r.id,
      });
      assert.equal(descriptor.encoding, "json");
      assert.ok(descriptor.totalBytes > 2 * article.length);
      await b.call("transfers/release", { transferId: descriptor.downloadId });
    }
  } finally {
    await b.dispose();
  }
});
