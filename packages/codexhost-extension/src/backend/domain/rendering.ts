import { createHash } from "node:crypto";
import { Marked } from "marked";
import {
  parse,
  parseFragment,
  serialize,
  type DefaultTreeAdapterTypes as P,
} from "parse5";
import assets from "./publication.json" with { type: "json" };
import type { Report, Topic, SubAgenda } from "./models.ts";

const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const markdown = new Marked({
  async: false,
  gfm: true,
  renderer: {
    html: ({ text }) => escape(text),
    image: ({ text }) => escape(text),
  },
});
const allowed = new Set(
  "a p hr br strong b em i del s blockquote pre code ul ol li h1 h2 h3 h4 h5 h6 table thead tbody tr th td".split(
    " ",
  ),
);
const printBridge =
  "window.addEventListener('message',e=>{if(e.source===parent&&e.data==='althing.print')window.print()});";
const controls =
  printBridge +
  "document.querySelector('[data-mode]').onclick=()=>document.documentElement.toggleAttribute('data-dark');document.querySelector('[data-print]').onclick=()=>window.print();";
const tabs =
  "for(const group of document.querySelectorAll('[data-group]')){const buttons=[...group.querySelectorAll('button')];function select(b){for(const item of buttons){const on=b===item;item.setAttribute('aria-pressed',String(on));document.getElementById(item.getAttribute('aria-controls')).hidden=!on}}for(const b of buttons)b.onclick=()=>select(b);if(buttons.length)select(buttons[0])}";
const policy = (script: string) =>
  "default-src 'none'; script-src 'sha256-" +
  createHash("sha256").update(script).digest("base64") +
  "'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'; object-src 'none'";
const book = '<img alt="" src="' + assets.book + '">',
  owl = '<img alt="" src="' + assets.owl + '">';
const mast = (label: string, title: string, subtitle: string) =>
  '<div class="mast"><div><div class="label">' +
  escape(label) +
  "</div><h1>" +
  escape(title) +
  "</h1><div>" +
  escape(subtitle) +
  "</div></div>" +
  owl +
  "</div>";
function page(title: string, body: string, script = controls) {
  return (
    '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="' +
    policy(script) +
    '"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' +
    escape(title) +
    "</title><style>" +
    assets.css +
    "</style></head><body><header><strong>" +
    book +
    "The Althing</strong><button data-mode>明暗模式</button><button data-print>打印 / PDF</button></header><main>" +
    body +
    "</main><script>" +
    script +
    "</script></body></html>"
  );
}
function md(source: string, headings?: string[]) {
  function clean(node: P.ChildNode): string {
    if (node.nodeName === "#text") return escape((node as P.TextNode).value);
    if (!("tagName" in node)) return "";
    const tag = node.tagName,
      inner = node.childNodes.map(clean).join("");
    if (!allowed.has(tag)) return inner;
    let attrs = "";
    if (tag === "a") {
      const href = node.attrs.find((a) => a.name === "href")?.value ?? "";
      try {
        if (
          ["https:", "http:", "mailto:"].includes(
            new URL(href, "https://localhost/").protocol,
          )
        )
          attrs = ' href="' + escape(href) + '" rel="noopener noreferrer"';
      } catch {
        /* malformed link */
      }
    }
    if (headings && ["h1", "h2", "h3"].includes(tag)) {
      const anchor = "section-" + (headings.length + 1);
      headings.push(
        '<a href="#' + anchor + '">' + inner.replace(/<[^>]*>/g, "") + "</a>",
      );
      attrs = ' id="' + anchor + '"';
    }
    return (
      "<" +
      tag +
      attrs +
      ">" +
      (["br", "hr"].includes(tag) ? "" : inner + "</" + tag + ">")
    );
  }
  return parseFragment(markdown.parse(source, { async: false }))
    .childNodes.map(clean)
    .join("");
}
export function markdownReport(r: Report, topicTitle: string) {
  const links: string[] = [];
  const body = md(r.markdown_content ?? "", links);
  const toc = links.length
    ? '<details class="toc"><summary>目录</summary><nav aria-label="报告目录">' +
      links.join("") +
      "</nav></details>"
    : "";
  return page(
    r.title,
    mast(topicTitle + "  /  v" + r.version, r.title, r.subtitle) +
      "<div" +
      (toc ? ' class="layout"' : "") +
      ">" +
      toc +
      '<article class="body">' +
      body +
      "</article></div>",
  );
}
export function authoredReport(r: Report) {
  const restrictions =
    "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; media-src data:; frame-src 'none'; form-action 'none'; base-uri 'none'; object-src 'none'";
  const doc = parse(r.source_html ?? r.html_content ?? "");
  function prune(parent: P.ParentNode) {
    parent.childNodes = parent.childNodes.filter(
      (n) =>
        !(
          "tagName" in n &&
          (n.tagName === "base" ||
            (n.tagName === "meta" &&
              n.attrs.some((a) => a.name === "http-equiv")))
        ),
    );
    for (const n of parent.childNodes) if ("childNodes" in n) prune(n);
  }
  prune(doc);
  const html = doc.childNodes.find(
    (n) => "tagName" in n && n.tagName === "html",
  ) as P.Element;
  for (const el of html.childNodes)
    if ("tagName" in el) {
      if (el.tagName === "head")
        el.childNodes.unshift(
          ...parseFragment(
            '<meta http-equiv="Content-Security-Policy" content="' +
              restrictions +
              '">',
          ).childNodes,
        );
      if (el.tagName === "body")
        el.childNodes.push(
          ...parseFragment("<script>" + printBridge + "</script>").childNodes,
        );
    }
  const forward =
    "function printArticle(){document.querySelector('iframe').contentWindow.postMessage('althing.print','*')}document.querySelector('button').onclick=printArticle;window.addEventListener('message',e=>{if(e.source===parent&&e.data==='althing.print')printArticle()});";
  return (
    '<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="' +
    restrictions.replace("frame-src 'none'", "frame-src about:") +
    '"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' +
    escape(r.title) +
    "</title><style>" +
    assets.css +
    "html,body{height:100%}body{display:flex;flex-direction:column}iframe{flex:1;min-height:0;width:100%;border:0}</style></head><body><header><strong>" +
    book +
    'The Althing</strong><button>打印 / PDF</button></header><iframe title="' +
    escape(r.title) +
    '" sandbox="allow-scripts allow-modals" srcdoc="' +
    escape(serialize(doc)) +
    '"></iframe><script>' +
    forward +
    "</script></body></html>"
  );
}
export const renderReport = (r: Report, title: string) =>
  r.format === "html" ? authoredReport(r) : markdownReport(r, title);
const bullets = (items: string[]) =>
  items.length
    ? "<ul>" + items.map((s) => "<li>" + md(s) + "</li>").join("") + "</ul>"
    : "";
const tabbar = (items: string[], prefix: string) =>
  '<nav class="tabs" data-group>' +
  items
    .map(
      (s, i) =>
        '<button aria-controls="' + prefix + i + '">' + escape(s) + "</button>",
    )
    .join("") +
  "</nav>";
function subView(s: SubAgenda) {
  let body = md(s.prompt_framing);
  for (const n of [
    ...new Set(
      [...s.dispatches, ...s.contributions].map((x) => x.round_number),
    ),
  ].sort((a, b) => a - b)) {
    body += "<h3>Round " + n + "</h3>";
    for (const d of s.dispatches.filter((d) => d.round_number === n))
      body +=
        "<article><b>" +
        escape(d.moderator_name + " · " + d.title) +
        "</b>" +
        md(d.prompt_summary) +
        "<details><summary>展开主持人任务</summary>" +
        md(d.prompt_full) +
        "</details></article>";
    for (const c of s.contributions.filter((c) => c.round_number === n))
      body +=
        '<article class="expert"><b>' +
        escape(c.panelist_name || c.panelist_id) +
        "</b> · " +
        escape(c.model) +
        md(c.summary) +
        bullets(c.key_points) +
        "<details><summary>展开完整原文</summary>" +
        md(c.full_content) +
        "</details></article>";
  }
  return (
    body +
    (s.synthesis_summary ? "<h3>子议程综述</h3>" + md(s.synthesis_summary) : "")
  );
}
export function offlineView(t: Topic, { embedReports = false } = {}) {
  const link = (r: Report) =>
    '<p><a href="' +
    (embedReports
      ? "data:text/html;base64," +
        Buffer.from(r.html_content ?? "").toString("base64") +
        '" download="' +
        escape(r.id) +
        ".html"
      : "reports/" + escape(r.id) + ".html") +
    '">' +
    escape(r.title) +
    "</a></p>";
  let body =
    mast(t.protocol_id, t.title, t.subtitle) +
    tabbar(
      ["总览", ...t.agendas.map((a) => a.code + " · " + a.title)],
      "agenda-",
    );
  body +=
    '<section id="agenda-0" class="body">' +
    md(t.description) +
    md(t.executive_summary) +
    bullets(t.key_takeaways) +
    t.reports.map(link).join("") +
    "</section>";
  t.agendas.forEach((a, i) => {
    const prefix = "sub-" + (i + 1) + "-";
    body +=
      '<section id="agenda-' +
      (i + 1) +
      '" class="body"><h2>' +
      escape(a.title) +
      "</h2>" +
      md(a.objective) +
      md(a.conclusion_summary) +
      bullets(a.conclusion_key_points) +
      bullets(a.open_disagreements) +
      t.reports
        .filter((r) => r.agenda_id === a.id)
        .map(link)
        .join("") +
      tabbar(
        a.sub_agendas.map((s) => s.code + " · " + s.title),
        prefix,
      );
    a.sub_agendas.forEach((s, j) => {
      body +=
        '<section id="' +
        prefix +
        j +
        '"><h3>' +
        escape(s.title) +
        "</h3>" +
        subView(s) +
        "</section>";
    });
    body += "</section>";
  });
  return page(t.title, body, controls + tabs);
}
