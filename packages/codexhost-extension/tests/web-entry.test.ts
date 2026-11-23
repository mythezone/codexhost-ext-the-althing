import test from "node:test";
import assert from "node:assert/strict";
import { dom, mockUI, eventually, query } from "./ui-host";
test("Web entry registers a localized main workspace and disposes panel instances and listeners", async (t) => {
  dom(t);
  const h = mockUI();
  let panel: any,
    tracked: (() => void) | undefined,
    registrations = 0;
  const web = await import(
    new URL("../dist/web/index.mjs", import.meta.url).href
  );
  const dispose = await web.activate({
    ...h.api,
    track: (f: () => void) => (tracked = f),
    panels: {
      register: (p: any) => {
        panel = p;
        registrations++;
        return () => registrations--;
      },
    },
  });
  assert.equal(panel.id, "the-althing");
  assert.equal(panel.placement, "main");
  assert.equal(panel.title["zh-CN"], "议事厅");
  const root = document.createElement("div");
  document.body.append(root);
  const c = new AbortController();
  const off = panel.render(root, c.signal);
  await eventually(() =>
    query(root).getByRole("button", { name: "New Council" }),
  );
  c.abort();
  off();
  assert.equal(root.childElementCount, 0);
  panel.render(root, new AbortController().signal);
  await eventually(() => query(root).getByText("Research council"));
  h.controller.abort();
  dispose();
  tracked?.();
  assert.equal(root.childElementCount, 0);
  assert.equal(registrations, 0);
  assert.equal(h.listeners.size, 0);
});

test("native Web tracks document language and system appearance without page-only API hooks", async (t) => {
  dom(t);
  const host = mockUI(),
    { locale, colorScheme, onLocaleChange, onColorSchemeChange, ...native } =
      host.api;
  document.documentElement.lang = "zh-CN";
  document.documentElement.classList.add("dark");
  let panel: any;
  const web = await import(
    new URL("../dist/web/index.mjs", import.meta.url).href
  );
  const stop = await web.activate({
    ...native,
    track: () => {},
    panels: {
      register: (p: any) => {
        panel = p;
        return () => {};
      },
    },
  });
  const root = document.createElement("main");
  document.body.append(root);
  panel.render(root, native.signal);
  try {
    await eventually(() =>
      query(root).getByRole("button", { name: "新建议题" }),
    );
    assert.equal(
      root
        .firstElementChild!.shadowRoot!.querySelector(".althing-ext-root")!
        .getAttribute("data-theme"),
      "obsidian-night",
    );
    document.documentElement.lang = "en";
    await eventually(() =>
      query(root).getByRole("button", { name: "New Council" }),
    );
  } finally {
    stop();
  }
});
