import test from "node:test";
import assert from "node:assert/strict";
import { dom, mockUI, eventually, query, fireEvent, within } from "./ui-host";
import { mockHost } from "./mock-host";
import { until } from "./helpers";
import type { Topic, Card } from "../src/frontend/types";
import { RpcClient } from "../src/frontend/rpc-client";

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
  Object.defineProperty(navigator, "language", {
    configurable: true,
    value: "zh-CN",
  });
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
      query(root).getByRole("button", { name: "New Council" }),
    );
    document.documentElement.lang = "zh-CN";
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

test("chat command directly convenes a council with smart allocation, Tab autocomplete, and custom override", async (t) => {
  dom(t);
  const h = mockUI(),
    host = await mockHost(t);
  const handlers = new Map<string, (p: any) => Promise<unknown>>();
  const backend = await (
    await import(new URL("../dist/backend/index.mjs", import.meta.url).href)
  ).activate({
    dataDir: host.dataDir,
    readSettings: async () => ({}),
    handle: (name: string, fn: (p: any) => Promise<unknown>) =>
      handlers.set(name, fn),
  });
  const bridge = { invoke: (name: string, p: any) => handlers.get(name)!(p) };
  const rpc = new RpcClient(bridge);
  const shell = document.createElement("div");
  shell.setAttribute("data-composer-card", "");
  shell.innerHTML =
    '<textarea></textarea><button aria-label="Send message"></button>';
  document.body.append(shell);
  const input = shell.querySelector("textarea")!;
  const web = await import(
    new URL("../dist/web/index.mjs", import.meta.url).href
  );
  const dispose = await web.activate({
    ...h.api,
    backend: bridge,
    track() {},
    dom: {
      mount(parent: HTMLElement) {
        const container = document.createElement("section");
        parent.append(container);
        return { container, dispose: () => container.remove() };
      },
    },
    panels: { register: () => () => {} },
  });
  try {
    const mounted = () =>
      document.querySelector<HTMLElement>("[data-althing-web-workspace]");
    const enter = (options = {}) =>
      fireEvent.keyDown(input, { key: "Enter", ...options });
    for (const text of ["ordinary prompt", "/althings", "prefix /althing"]) {
      input.value = text;
      assert.equal(enter(), true);
      assert.equal(mounted(), null);
      assert.equal(input.value, text);
    }

    // Tab autocomplete from /alt -> /althing 
    input.value = "/alt";
    fireEvent.input(input);
    const hint = () =>
      shell.querySelector("[data-althing-command]")?.textContent;
    await eventually(() => hint()?.endsWith("Start a council"));
    assert.equal(fireEvent.keyDown(input, { key: "Tab" }), false);
    assert.equal(input.value, "/althing ");

    // Multi-line direct convene via Send button (including localized Send label)
    input.value = "/althing Transit study\nCompare weekday service.";
    assert.equal(enter({ shiftKey: true }), true);
    assert.equal(enter({ isComposing: true }), true);
    assert.equal(mounted(), null);
    fireEvent.input(input);
    document.documentElement.lang = "zh-HK";
    await eventually(() => hint()?.endsWith("Press Enter to convene council"));
    for (const [language, translation] of [
      ["zh-CN", "回车直接召开议会"],
      ["zh-TW", "Enter 直接召開議會"],
      ["ja", "Enter で会議をすぐ開く"],
      ["ko", "Enter로 바로 회의 열기"],
      ["en", "Press Enter to convene council"],
    ]) {
      for (const change of h.languages) change(language);
      await eventually(() => hint()?.endsWith(translation));
    }
    for (const change of h.listeners) change({ language: "ja" });
    await eventually(() => hint()?.endsWith("Enter で会議をすぐ開く"));
    for (const change of h.listeners) change({ language: "auto" });
    await eventually(() => hint()?.endsWith("Press Enter to convene council"));
    shell
      .querySelector("button[aria-label]")!
      .setAttribute("aria-label", "送信");
    assert.equal(
      fireEvent.click(shell.querySelector("button[aria-label]")!),
      false,
    );

    const surface = await eventually(mounted);
    const ui = await eventually(() => query(surface));
    assert.equal(input.value, "");
    // Direct convene skips the wizard dialog and opens the live council page immediately.
    await eventually(
      () => ui.getByRole("heading", { name: "Transit study", level: 1 }),
      6000,
    );
    assert.equal(ui.queryByRole("dialog"), null);
    await eventually(() => host.threads.size === 1, 8000);
    const request = host.routes("delegate/start")[0].body;
    assert.equal(request.harness, "codex");
    assert.match(String(request.task), /Transit study/);
    assert.match(String(request.task), /Compare weekday service/);

    host.finish(
      [...host.threads.keys()][0],
      JSON.stringify({
        agendas: [
          { title: "Routes", sub_agendas: [{ title: "Weekday service" }] },
        ],
      }),
    );
    const [card] = await rpc.call<Card[]>("topics/list");
    const tree = await until(
      () => rpc.call<Topic>("topics/get", { topicId: card.id }),
      (t) =>
        t.agendas.length === 1 &&
        t.agendas[0].sub_agendas[0].dispatches.length === 1,
      10000,
    );
    assert.equal(tree.agendas[0].sub_agendas[0].title, "Weekday service");
    assert.equal(tree.panelists.length, 2);
    assert.equal(tree.moderator.provider, "codex");
    // 1 plan + 2 auto-dispatched opening panelists = 3 threads!
    await eventually(() => host.threads.size === 3, 8000);

    fireEvent.click(ui.getByRole("button", { name: "Back to chat" }));
    await eventually(() => !mounted());

    // --custom opens the 1-screen Quick Convene dialog prefilled instead of auto-launching
    input.value = "/althing --custom Custom topic";
    fireEvent.input(input);
    await eventually(() => hint()?.endsWith("Start a council"));
    assert.equal(enter(), false);
    const customSurface = await eventually(mounted);
    const customUi = await eventually(() => query(customSurface));
    const dialog = within(await eventually(() => customUi.getByRole("dialog")));
    assert.equal(
      (dialog.getByLabelText("Title") as HTMLTextAreaElement).value,
      "Custom topic",
    );
    fireEvent.click(customUi.getByRole("button", { name: "Back to chat" }));
    await eventually(() => !mounted());
  } finally {
    dispose();
    await backend.dispose();
  }
  input.value = "/althing";
  assert.equal(fireEvent.keyDown(input, { key: "Enter" }), true);
});
