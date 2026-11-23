import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { parse } from "parse5";
import { Ajv2020 } from "ajv/dist/2020.js";
import formats from "ajv-formats";
import { Store } from "../src/backend/storage.ts";
import { hydrate } from "../src/backend/domain/council.ts";
import { offlineView } from "../src/backend/domain/rendering.ts";
import {
  archiveZip,
  inspectArchiveZip,
  restoreArchive,
  exportMarkdownBundle,
  exportStandaloneHtml,
} from "../src/backend/domain/archives.ts";
import {
  readZip,
  writeZip,
  MAX_BYTES,
  MAX_ENTRIES,
} from "../src/backend/domain/zip.ts";
import { temp, councilFixture, dispatch, contribution } from "./helpers.ts";
import schema from "../../protocol/topic.schema.json" with { type: "json" };

test("Markdown escapes raw HTML, filters links/images, numbers headings and hashes the print/theme bridge", () => {
  const c = councilFixture(),
    report = c.create(
      "report",
      {
        title: "R<&",
        markdown_content:
          "# *First*\n\n## Next\n\n<script>alert(1)</script>\n\n[bad](javascript:bad) ![missing](https://remote.example/x) [safe](https://example.org)",
      },
      "study",
    );
  const html = report.html_content!;
  assert.ok(!html.includes("<script>alert"));
  assert.ok(!html.includes('href="javascript:'));
  assert.ok(!html.includes("remote.example"));
  assert.match(html, /href="#section-1">First</);
  assert.match(html, /id="section-2"/);
  assert.match(html, /href="https:\/\/example.org"/);
  const script = html.match(/<script>(.*?)<\/script>/s)![1];
  assert.ok(
    html.includes(
      "sha256-" + createHash("sha256").update(script).digest("base64"),
    ),
  );
  assert.match(script, /althing.print/);
  assert.match(html, /data-dark/);
});
test("authored HTML keeps inline art and scripts in an opaque sandbox with a leading child CSP", () => {
  const c = councilFixture();
  const source =
    '<html><head><base href="https://example.org"><meta http-equiv="refresh" content="0"></head><body><svg></svg><script>window.chart=1</script></body></html>';
  const r = c.create(
      "report",
      { title: 'Q" />', html_content: source },
      "study",
    ),
    html = r.html_content!;
  assert.equal(r.source_html, source);
  assert.match(html, /sandbox="allow-scripts allow-modals"/);
  assert.ok(!html.includes("allow-same-origin"));
  const doc = parse(html),
    root = doc.childNodes.find(
      (n) => n.nodeName === "html",
    ) as import("parse5").DefaultTreeAdapterTypes.Element;
  const body = root.childNodes.find(
    (n) => n.nodeName === "body",
  ) as typeof root;
  const frame = body.childNodes.find(
    (n) => n.nodeName === "iframe",
  ) as typeof root;
  const inner = frame.attrs.find((a) => a.name === "srcdoc")!.value;
  assert.ok(inner.includes('<head><meta http-equiv="Content-Security-Policy"'));
  assert.match(inner, /frame-src 'none'/);
  assert.ok(!inner.includes("<base"));
  assert.ok(!inner.includes('http-equiv="refresh"'));
  assert.ok(inner.includes("<svg>"));
  assert.ok(inner.includes("window.chart"));
  assert.match(inner, /althing.print/);
});
test("v1 checksums, interactive viewers, Markdown files and two-pass restore preserve graph, pins, dates and primary reports", async (t) => {
  const c = councilFixture();
  c.patch("sub_agenda", "s2", { depends_on: ["s"] });
  c.create("dispatch", dispatch, "s");
  c.create("contribution", contribution, "s");
  c.create(
    "contribution",
    {
      ...contribution,
      id: "peer",
      dispatch_id: null,
      kind: "critique",
      target_contribution_ids: ["c"],
    },
    "s2",
  );
  const primary = c.create(
    "report",
    { title: "Primary", markdown_content: "# First", agenda_id: "a" },
    "study",
  );
  c.create(
    "report",
    {
      title: "Later",
      html_content: "Layout",
      agenda_id: "a",
      set_as_primary: false,
    },
    "study",
  );
  c.create("report", { title: "Final", markdown_content: "# Final" }, "study");
  c.patch("agenda", "a", { progress_pct: 35 });
  const tree = hydrate(c.tree, true),
    blob = archiveZip(tree),
    files = readZip(blob);
  const manifest = JSON.parse(files.get("manifest.json")!.toString());
  for (const [name, bytes] of files)
    if (name !== "manifest.json")
      assert.equal(
        manifest.files[name],
        createHash("sha256").update(bytes).digest("hex"),
      );
  assert.match(offlineView(tree), /data-group/);
  assert.match(
    exportStandaloneHtml(tree).toString(),
    /href="data:text\/html;base64,/,
  );
  assert.ok(readZip(exportMarkdownBundle(tree)).has("agendas/a.md"));
  const store = await Store.open(await temp(t)),
    restored = await restoreArchive(store, inspectArchiveZip(blob));
  const out = hydrate(await store.full(await store.load(restored)), true);
  const ajv = new Ajv2020({ strict: false });
  formats.default(ajv);
  const validate = ajv.compile(schema);
  assert.ok(validate(out), JSON.stringify(validate.errors));
  assert.notEqual(restored, tree.id);
  assert.equal(out.status, "archived");
  assert.equal(out.created_at, tree.created_at);
  assert.equal(out.updated_at, tree.updated_at);
  assert.equal(out.archives.length, 1);
  const a = out.agendas[0],
    [s1, s2] = a.sub_agendas;
  assert.equal(a.report_id, out.reports[0].id);
  assert.notEqual(a.report_id, primary.id);
  assert.equal(out.final_report_id, out.reports[2].id);
  assert.deepEqual(a.pinned_fields, ["progress_pct"]);
  assert.equal(a.progress_pct, 35);
  assert.deepEqual(s2.depends_on, [s1.id]);
  assert.deepEqual(s2.contributions[0].target_contribution_ids, [
    s1.contributions[0].id,
  ]);
  assert.equal(s1.contributions[0].dispatch_id, s1.dispatches[0].id);
  assert.equal(
    s1.contributions[0].created_at,
    tree.agendas[0].sub_agendas[0].contributions[0].created_at,
  );
  assert.equal(out.reports[1].source_html, "Layout");
  assert.match(out.reports[1].html_content!, /sandbox=/);
  files.set("README.md", Buffer.from("changed"));
  assert.throws(() => inspectArchiveZip(writeZip(files)), /checksum/);
  files.set("alien", Buffer.alloc(0));
  assert.throws(() => inspectArchiveZip(writeZip(files)));
});
test("imports a ZIP produced by the Python council, renderer and archive writer", async (t) => {
  const tree = inspectArchiveZip(
    await readFile(new URL("./fixtures/python-v1.zip", import.meta.url)),
  );
  const s = await Store.open(await temp(t));
  const restored = hydrate(await s.load(await restoreArchive(s, tree)));
  assert.equal(restored.title, "原版档案");
  assert.equal(restored.reports.length, 1);
  assert.equal(restored.archives.length, 1);
});
test("strict ZIP reader checks local and central names, CRC, expansion and entry limits", () => {
  const zip = writeZip(
    new Map([
      ["a", Buffer.from("1")],
      ["b", Buffer.alloc(5000, 1)],
    ]),
  );
  assert.deepEqual([...readZip(zip).keys()], ["a", "b"]);
  const central = zip.readUInt32LE(zip.length - 6);
  for (const mutate of [
    (b: Buffer) => b.writeUInt32LE(MAX_BYTES + 1, central + 24),
    (b: Buffer) => b.writeUInt16LE(MAX_ENTRIES + 1, b.length - 12),
    (b: Buffer) => b.writeUInt32LE(10, 14),
    (b: Buffer) => b.writeUInt16LE(99, 8),
    (b: Buffer) => b.write("/", 30),
    (b: Buffer) => b.write("a", central + 47 + 46),
  ]) {
    const copy = Buffer.from(zip);
    mutate(copy);
    assert.throws(() => readZip(copy));
  }
  for (const name of ["../bad", "C:/bad", "/bad", "a\\b"])
    assert.throws(() => writeZip(new Map([[name, Buffer.alloc(0)]])));
  assert.throws(() => readZip(zip.subarray(3)));
});
test("restored run history links to new resources and an in-flight source turn remains historical", async (t) => {
  const c = councilFixture();
  c.create("dispatch", dispatch, "s");
  c.create("contribution", contribution, "s");
  const config = {
    harnessId: "codex",
    thinking: "high",
    model: "model",
    threadId: "source-thread",
  };
  const run = {
    ...config,
    kind: "panelist",
    topicId: "study",
    agendaId: "a",
    subAgendaId: "s",
    dispatchId: "d",
    panelistId: "p1",
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  c.patch("topic", "study", {
    metadata: {
      codexhost: {
        project_cwd: "/project",
        panelist_threads: { p1: config },
        runs: [
          { ...run, id: "one", status: "completed", contributionId: "c" },
          {
            ...run,
            id: "two",
            status: "running",
            targetContributionIds: ["c"],
          },
        ],
      },
    },
  });
  const store = await Store.open(await temp(t)),
    tid = await restoreArchive(
      store,
      inspectArchiveZip(archiveZip(hydrate(c.tree, true))),
    );
  const tree = await store.load(tid),
    host = tree.metadata.codexhost as {
      runs: {
        status: string;
        contributionId?: string;
        topicId: string;
        targetContributionIds?: string[];
      }[];
      panelist_threads: { p1: typeof config };
    };
  const cid = tree.agendas[0].sub_agendas[0].contributions[0].id;
  assert.equal(host.runs[0].contributionId, cid);
  assert.equal(host.runs[0].topicId, tid);
  assert.deepEqual(host.runs[1].targetContributionIds, [cid]);
  assert.equal(host.runs[1].status, "cancelled");
  assert.equal(host.panelist_threads.p1.threadId, null);
  assert.equal((await store.list())[0].activeRunCount, 0);
});

test("report and offline Markdown tables are focusable scroll regions", () => {
  const c = councilFixture();
  const markdown = "| Site | Observation |\n| --- | --- |\n| South | Review |";
  const report = c.create(
    "report",
    { title: "Survey", markdown_content: markdown },
    "study",
  );
  c.patch("topic", "study", { description: markdown });
  for (const html of [report.html_content!, offlineView(hydrate(c.tree))]) {
    assert.ok(
      html.includes(
        '<div class="table-scroll" role="region" tabindex="0"><table>',
      ),
    );
    assert.ok(html.includes("data-althing-mobile-tables"));
  }
});

test("legacy layout upgrade preserves scripts, author srcdoc, CSP and existing regions byte-for-byte", async () => {
  const { reportDocument } = await import("../src/shared/report-document");
  const script =
    'const sample = "<table></table></head>";\r\n// original bytes';
  const hash = createHash("sha256").update(script).digest("base64");
  const embedded =
    '<iframe sandbox="allow-scripts" srcdoc="&lt;table>&lt;/table>"></iframe>';
  const source =
    '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="script-src ' +
    "'sha256-" +
    hash +
    "'\"></head><body><!-- <table> -->" +
    embedded +
    "<TABLE><tr><td>旧报告</td></tr></TABLE><script>" +
    script +
    "</script></body></html>";
  const html = reportDocument(source, true);
  assert.ok(html.includes("<html data-dark>"));
  assert.ok(html.includes(embedded));
  assert.ok(html.includes("<script>" + script + "</script>"));
  assert.ok(html.includes("'sha256-" + hash + "'"));
  assert.equal(html.match(/role="region"/g)?.length, 1);
  assert.equal(reportDocument(html, true), html);
  const c = councilFixture();
  const r = c.create(
    "report",
    { title: "Stored", markdown_content: "Report" },
    "study",
  );
  const tree = hydrate(c.tree, true);
  tree.reports[0].html_content = source;
  const offline = exportStandaloneHtml(tree).toString();
  const embeddedReport = offline.match(/data:text\/html;base64,([^"]+)"/)![1];
  assert.equal(
    Buffer.from(embeddedReport, "base64").toString(),
    reportDocument(source, false),
  );
  assert.equal(tree.reports[0].id, r.id);
  assert.equal(tree.reports[0].html_content, source);
});
