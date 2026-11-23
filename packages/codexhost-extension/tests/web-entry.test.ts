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

test("chat command selects a moderator, plans a topic via the backend, and waits for expert dispatch", async (t) => {
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
    for (const text of [
      "ordinary prompt",
      "/althings",
      "prefix /althing",
      "/althing\nkeep this draft",
    ]) {
      input.value = text;
      assert.equal(enter(), true);
      assert.equal(mounted(), null);
      assert.equal(input.value, text);
    }
    input.value = "/althing Transit study";
    assert.equal(enter({ shiftKey: true }), true);
    assert.equal(enter({ isComposing: true }), true);
    assert.equal(mounted(), null);
    fireEvent.input(input);
    const hint = () =>
      shell.querySelector("[data-althing-command]")?.textContent;
    document.documentElement.lang = "zh-HK";
    await eventually(() => hint()?.endsWith("Start a council"));
    for (const [language, translation] of [
      ["zh-CN", "发起会议"],
      ["zh-TW", "發起會議"],
      ["ja", "会議を開く"],
      ["ko", "회의 시작"],
      ["en", "Start a council"],
    ]) {
      for (const change of h.languages) change(language);
      await eventually(() => hint()?.endsWith(translation));
    }
    for (const change of h.listeners) change({ language: "ja" });
    await eventually(() => hint()?.endsWith("会議を開く"));
    for (const change of h.listeners) change({ language: "auto" });
    await eventually(() => hint()?.endsWith("Start a council"));
    shell
      .querySelector("button[aria-label]")!
      .setAttribute("aria-label", "送信");
    assert.equal(
      fireEvent.click(shell.querySelector("button[aria-label]")!),
      false,
    );
    const surface = await eventually(mounted);
    const ui = await eventually(() => query(surface));
    const dialog = within(await eventually(() => ui.getByRole("dialog")));
    assert.equal(
      (dialog.getByLabelText("Title") as HTMLInputElement).value,
      "Transit study",
    );
    assert.equal(input.value, "");
    fireEvent.change(dialog.getByLabelText("Project workspace"), {
      target: { value: host.root },
    });
    fireEvent.change(
      dialog.getByLabelText("How many experts should participate?"),
      { target: { value: "1" } },
    );
    fireEvent.click(dialog.getByText("Continue"));
    const harness = await eventually(() => dialog.getByLabelText("Harness"));
    await eventually(() => dialog.getByRole("option", {name: /^Codex · /}), 6000);
    fireEvent.change(harness, { target: { value: "codex" } });
    await eventually(() =>
      dialog.getByRole("option", { name: /literal · Fast/ }),
    );
    fireEvent.change(dialog.getByLabelText("Model"), {
      target: { value: "literal~fast" },
    });
    fireEvent.click(dialog.getByText("Continue"));
    fireEvent.change(
      await eventually(() => dialog.getByLabelText(/Which questions/)),
      { target: { value: "Compare weekday service." } },
    );
    assert.equal(host.threads.size, 0);
    fireEvent.click(
      dialog.getByRole("button", { name: "Create and plan agenda" }),
    );
    await eventually(() => host.threads.size === 1, 8000);
    const request = host.routes("delegate/start")[0].body;
    assert.equal(request.harness, "codex");
    assert.deepEqual(request.model, { id: "literal~fast" });
    assert.match(String(request.task), /Compare weekday service/);
    assert.match(String(request.task), /Transit study/);
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
      (t) => t.agendas.length === 1,
      10000,
    );
    assert.equal(tree.agendas[0].sub_agendas[0].title, "Weekday service");
    assert.equal(tree.panelists.length, 1);
    assert.equal(tree.moderator.provider, "codex");
    assert.equal(host.threads.size, 1);
    fireEvent.click(ui.getByRole("button", { name: "Back to chat" }));
    await eventually(() => !mounted());
  } finally {
    dispose();
    await backend.dispose();
  }
  input.value = "/althing";
  assert.equal(fireEvent.keyDown(input, { key: "Enter" }), true);
});
