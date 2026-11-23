import test from "node:test";
import assert from "node:assert/strict";
import { Script } from "node:vm";
import { readFile } from "node:fs/promises";
import { dom, mockUI, eventually, query, fireEvent, wait } from "./ui-host";
test("Desktop classic entry coexists with thread tree, tracks geometry, yields to navigation and cleans up", async (t) => {
  dom(t);
  const h = mockUI();
  const original = h.api.backend.invoke.bind(h.api.backend);
  const cards = (await original(
    "althing/topics/list",
  )) as import("../src/frontend/types").Card[];
  let items = cards.slice(0, 1),
    cursor = 0;
  const backend = {
    invoke: async (method: string, p: any) => {
      if (method === "althing/topics/list") return items;
      if (method === "althing/events/since")
        return {
          cursor,
          events: p.cursor < cursor ? [{}] : [],
          activeRunCount: 0,
        };
      return original(method, p);
    },
  };
  function update(next: typeof items) {
    items = next;
    cursor++;
    document.dispatchEvent(new Event("visibilitychange"));
  }
  document.body.innerHTML =
    '<aside><div data-app-action-sidebar-scroll><section><button data-app-action-sidebar-project-id="folder-1" data-app-action-sidebar-project-row data-app-action-sidebar-project-collapsed="false" data-app-action-sidebar-project-label="Study">Study</button><div data-codexhost-sidebar-tree-children><button>Existing tree</button></div><button data-app-action-sidebar-thread-row><span data-thread-title style="font-size: 12px">Thread</span></button></section><section id="empty"><button data-project-cwd="/empty">Empty</button></section></div></aside><nav data-app-navigation-rail><button data-sidebar-destination>Home</button></nav><main>Native chat</main>';
  const aside = document.querySelector("aside")!,
    foreign = document.querySelector("[data-codexhost-sidebar-tree-children]")!,
    before = foreign.outerHTML;
  let right = 260;
  aside.getBoundingClientRect = () =>
    ({ right, width: right, height: 700, top: 20 }) as DOMRect;
  let definition: any,
    defines = 0,
    tracked: (() => void) | undefined,
    subs = 0;
  const open: string[] = [];
  const code = await readFile(
    new URL("../dist/desktop/index.js", import.meta.url),
    "utf8",
  );
  new Script("(function(define){" + code + "\n})").runInThisContext()(
    (d: any) => {
      definition = d;
      defines++;
    },
  );
  assert.equal(defines, 1);
  const dispose = definition.activate({
    ...h.api,
    backend,
    assets: { readDataUrl: h.api.assets.readDataUrl },
    dom: {
      mount: (
        e: Element,
        p: Element,
        key: "prepend" | "append" | "after" = "append",
      ) => p[key](e),
    },
    sidebar: {
      observeRows: (fn: Function) => {
        subs++;
        fn([
          {
            threadId: "thread1",
            isLocal: true,
            element: document.querySelector(
              "[data-app-action-sidebar-thread-row]",
            ),
          },
        ]);
        return () => subs--;
      },
    },
    navigate: {
      openThread: async (id: string) => {
        open.push(id);
      },
    },
    track: (f: () => void) => (tracked = f),
  });
  const owned = (k: string) =>
    document.querySelector<HTMLElement>('[data-althing-owned="' + k + '"]');
  try {
    const top = await eventually(() => owned("top"));
    assert.match(top.textContent!, /The Althing1/);
    assert.equal(top.parentElement!.firstElementChild, top);
    assert.equal(top.style.fontSize, "12px");
    assert.equal(owned("group")?.style.fontSize, "12px");
    assert.equal(document.querySelector("#empty [data-althing-owned]"), null);
    update([{ ...cards[0], status: "completed", activeRunCount: 0 }]);
    await eventually(() => !owned("top") && owned("group"));
    for (const cb of h.listeners) cb({ sidebarAlthingVisibility: "always" });
    await eventually(() => owned("top")?.querySelector("small")?.hidden);
    update([]);
    await eventually(() => !owned("group") && owned("top"));
    for (const cb of h.listeners) cb({ sidebarAlthingVisibility: "hidden" });
    update([{ ...cards[0], status: "in_progress", activeRunCount: 0 }]);
    await eventually(() => !owned("top") && owned("group"));
    for (const cb of h.listeners) cb({});
    await eventually(() => owned("top"));
    update(cards.slice(0, 1));
    const composer = document.createElement("form");
    composer.setAttribute("data-codex-composer-root", "");
    composer.innerHTML = "<textarea></textarea>";
    document.body.append(composer);
    const prompt = composer.querySelector("textarea")!;
    prompt.value = "/althing Desktop meeting";
    fireEvent.input(prompt);
    const hint = () =>
      composer.querySelector("[data-althing-command]")?.textContent;
    for (const [language, title, command] of [
      ["zh-CN", "议事厅", "发起会议"],
      ["zh-HK", "議事廳", "發起會議"],
      ["ja-JP", "評議会", "会議を開く"],
      ["ko-KR", "의회", "회의 시작"],
      ["en", "The Althing", "Start a council"],
    ]) {
      for (const cb of h.languages) cb(language);
      await eventually(
        () =>
          owned("top")?.textContent?.startsWith(title) &&
          hint()?.endsWith(command),
      );
    }
    for (const cb of h.listeners) cb({ language: "ja" });
    await eventually(
      () =>
        hint()?.endsWith("会議を開く") &&
        owned("group-header")?.textContent?.includes("評議会"),
    );
    for (const cb of h.listeners) cb({ language: "auto" });
    await eventually(() => hint()?.endsWith("Start a council"));
    fireEvent.keyDown(prompt, { key: "Enter" });
    const commandOverlay = await eventually(() => owned("overlay"));
    await eventually(
      () =>
        (query(commandOverlay).getByLabelText("Title") as HTMLInputElement)
          .value === "Desktop meeting",
    );
    fireEvent.click(document.querySelector("[data-sidebar-destination]")!);
    await eventually(() => !owned("overlay"));
    composer.remove();
    fireEvent.click(await eventually(() => owned("group-header")));
    await eventually(() => owned("topic"));
    assert.equal(
      localStorage.getItem("the-althing.project./projects/study"),
      "open",
    );
    assert.equal(foreign.outerHTML, before);
    for (const cb of h.listeners) cb({ showProjectAlthingItems: false });
    await eventually(() => !owned("group"));
    for (const cb of h.listeners) cb({ showProjectAlthingItems: true });
    fireEvent.click(await eventually(() => owned("new")));
    let overlay = await eventually(() => owned("overlay"));
    const ui = await eventually(() => query(overlay));
    assert.equal(
      (
        (await eventually(() =>
          ui.getByLabelText("Project workspace"),
        )) as HTMLInputElement
      ).value,
      "/projects/study",
    );
    assert.equal(overlay.style.left, "260px");
    right = 305;
    window.dispatchEvent(new Event("resize"));
    assert.equal(overlay.style.left, "305px");
    fireEvent.click(document.querySelector("[data-sidebar-destination]")!);
    await eventually(() => !owned("overlay"));
    for (const attribute of [
      "data-codexhost-settings-trigger",
      "data-codexhost-settings-shell",
    ]) {
      const settings = document.createElement("div");
      settings.setAttribute(attribute, "");
      document.body.append(settings);
      const button = document.createElement("button");
      settings.attachShadow({ mode: "open" }).append(button);
      fireEvent.click(top);
      await eventually(() => owned("overlay"));
      fireEvent.click(button, { composed: true });
      await eventually(() => !owned("overlay"));
      settings.remove();
    }
    const oldSection = document.querySelector(
      "[data-app-action-sidebar-scroll] section",
    )!;
    const section = document.createElement("section");
    section.setAttribute("data-app-action-sidebar-project-collapsed", "false");
    section.append(
      foreign,
      oldSection.querySelector("[data-app-action-sidebar-thread-row]")!,
    );
    oldSection.replaceWith(section);
    await eventually(
      () => owned("group")?.parentElement === section && owned("topic"),
    );
    assert.equal(
      section.querySelectorAll('[data-althing-owned="group"]').length,
      1,
    );
    fireEvent.click(owned("topic")!);
    overlay = await eventually(() => owned("overlay"));
    fireEvent.click(
      await eventually(() =>
        query(overlay).getByRole("button", { name: "Open Thread" }),
      ),
    );
    await eventually(() => open[0] === "thread1");
    assert.equal(owned("overlay"), null);
    fireEvent.click(top);
    await eventually(() => owned("overlay"));
    fireEvent.click(
      document.querySelector("[data-app-action-sidebar-thread-row]")!,
    );
    await eventually(() => !owned("overlay"));
    fireEvent.click(top);
    const opened = await eventually(() => owned("overlay"));
    fireEvent.click(
      await eventually(() =>
        query(opened).getByRole("button", { name: "Back to chat" }),
      ),
    );
    assert.equal(owned("overlay"), null);
  } finally {
    dispose();
    tracked?.();
  }
  await wait(25);
  assert.equal(subs + h.listeners.size, 0);
  assert.equal(document.querySelector("[data-althing-owned]"), null);
  assert.equal(foreign.outerHTML, before);
});
