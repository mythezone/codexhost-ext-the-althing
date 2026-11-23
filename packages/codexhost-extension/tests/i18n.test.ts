import test from "node:test";
import assert from "node:assert/strict";
import { resolveLocale, translate } from "../src/shared/i18n.ts";
import { councilFixture, contribution, dispatch } from "./helpers.ts";
import { roundPrompt } from "../src/backend/domain/protocols.ts";
import { hydrate } from "../src/backend/domain/council.ts";
import {
  authoredReport,
  markdownReport,
  offlineView,
  publicationHtml,
} from "../src/backend/domain/rendering.ts";
import {
  archiveZip,
  exportStandaloneHtml,
} from "../src/backend/domain/archives.ts";
import { readZip } from "../src/backend/domain/zip.ts";

test("language negotiation respects the host's script, region and explicit plugin override", () => {
  for (const tag of ["zh", "zh-cn", "zh-SG", "zh_Hans_HK"])
    assert.equal(resolveLocale(tag), "zh-CN");
  for (const tag of ["zh-TW", "zh-HK", "zh-MO", "zh-Hant-CN"])
    assert.equal(resolveLocale(tag), "zh-TW");
  for (const [tag, expected] of [
    ["ja-JP", "ja"],
    ["ko-KR", "ko"],
    ["en-US", "en"],
    ["fr", "en"],
    ["zh-unknown", "en"],
    ["", "en"],
  ])
    assert.equal(resolveLocale(tag, "auto"), expected);
  assert.equal(resolveLocale(undefined), "en");
  assert.equal(resolveLocale("ja-JP", "zh-TW"), "zh-TW");
  assert.equal(resolveLocale("ja-JP", "unsupported"), "en");
});

test("report shells, archived reports and offline navigation share the selected language", () => {
  const c = councilFixture();
  c.create("dispatch", dispatch, "s");
  c.create("contribution", contribution, "s");
  c.patch("sub_agenda", "s", { synthesis_summary: "Keep the study open." });
  c.create(
    "report",
    {
      id: "report",
      title: "Publication",
      markdown_content: "## Evidence\nBody text.",
    },
    "study",
  );
  const tree = hydrate(c.tree, true),
    report = tree.reports[0];
  assert.match(markdownReport(report, "Research"), /<html lang="en">/);
  assert.match(exportStandaloneHtml(tree).toString(), /<html lang="en">/);
  for (const [locale, toc, overview, show] of [
    ["en", "Contents", "Overview", "Show full response"],
    ["zh-CN", "目录", "总览", "展开完整原文"],
    ["zh-TW", "目錄", "總覽", "展開完整原文"],
    [
      "ja",
      "目次",
      "概要",
      translate("ja", "Show full response", "展开完整原文"),
    ],
    [
      "ko",
      "목차",
      "개요",
      translate("ko", "Show full response", "展开完整原文"),
    ],
  ] as const) {
    const html = markdownReport(report, tree.title, locale),
      view = offlineView(tree, { locale });
    assert.ok(
      html.includes('<html lang="' + locale + '">') &&
        html.includes(">" + toc + "<"),
    );
    assert.ok(html.includes("Body text."));
    assert.ok(
      view.includes(">" + overview + "<") && view.includes(">" + show + "<"),
    );
    const authored = authoredReport(
      { ...report, source_html: "<p>Author text</p>" },
      locale,
    );
    assert.ok(
      authored.includes('<html lang="' + locale + '">') &&
        authored.includes("Author text"),
    );
    const files = readZip(archiveZip(tree, locale));
    assert.equal(files.get("reports/report.html")!.toString(), html);
    assert.equal(files.get("index.html")!.toString(), view);
  }
});

test("localizing a saved report preserves its original evidence, scripts and authored iframe", () => {
  const c = councilFixture();
  const raw = "<h1>Original article</h1><script>window.chart = 1;</script>";
  const report = c.create(
    "report",
    { title: "Report", html_content: raw },
    "study",
  );
  const source = report.html_content!;
  const target = publicationHtml(report, "ja");
  assert.match(target, /<html lang="ja">/);
  assert.match(target, /印刷/);
  assert.equal(
    target.match(/srcdoc="[^"]*"/)?.[0],
    source.match(/srcdoc="[^"]*"/)?.[0],
  );
  assert.equal(
    target.match(/<script>[\s\S]*?<\/script>/)?.[0],
    source.match(/<script>[\s\S]*?<\/script>/)?.[0],
  );
  const opaque = "<html><body><p>Hand-edited transcript</p></body></html>";
  assert.equal(
    publicationHtml({ ...report, html_content: opaque }, "ja"),
    opaque,
  );
  const tree = hydrate(c.tree),
    sub = tree.agendas[0].sub_agendas[0];
  for (const [locale, word] of [
    ["en", "independent"],
    ["zh-CN", "独立"],
    ["zh-TW", "獨立"],
    ["ja", "独立した評価"],
    ["ko", "독립적인 평가"],
  ] as const) {
    const text = roundPrompt(tree, sub, "opening", [], locale);
    assert.ok(text.includes(word) && text.includes(tree.title));
  }
});
