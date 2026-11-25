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
        key: "prepend" | "append" | "before" | "after" = "append",
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
    // Default visibility is now "always": top entry stays visible even with 0 active councils.
    update([{ ...cards[0], status: "completed", activeRunCount: 0 }]);
    await eventually(() => owned("top")?.querySelector("small")?.hidden && owned("group"));
    // Legacy sidebarAlthingVisibility: "active" upgrades to always-visible; "hidden" still hides.
    for (const cb of h.listeners) cb({ sidebarAlthingVisibility: "active" });
    await eventually(() => owned("top"));
    for (const cb of h.listeners) cb({ sidebarAlthingVisibility: "hidden" });
    await eventually(() => !owned("top"));
    // Explicit sidebarEntryVisibility controls always / active / hidden.
    for (const cb of h.listeners) cb({ sidebarEntryVisibility: "active" });
    await eventually(() => !owned("top") && owned("group"));
    update([{ ...cards[0], status: "in_progress", activeRunCount: 0 }]);
    await eventually(() => owned("top"));
    for (const cb of h.listeners) cb({ sidebarEntryVisibility: "always" });
    update([]);
    await eventually(() => !owned("group") && owned("top"));
    for (const cb of h.listeners) cb({ sidebarEntryVisibility: "hidden" });
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
      document.querySelector("[data-althing-command]")?.textContent;
    assert.equal(composer.querySelector("[data-althing-command]"), null);
    for (const [language, title, command] of [
      ["zh-CN", "议事厅", "回车直接召开议会"],
      ["zh-HK", "議事廳", "Enter 直接召開議會"],
      ["ja-JP", "評議会", "Enter で会議をすぐ開く"],
      ["ko-KR", "의회", "Enter로 바로 회의 열기"],
      ["en", "The Althing", "Press Enter to convene council"],
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
        hint()?.endsWith("Enter で会議をすぐ開く") &&
        owned("group-header")?.textContent?.includes("評議会"),
    );
    for (const cb of h.listeners) cb({ language: "auto" });
    await eventually(() => hint()?.endsWith("Press Enter to convene council"));
    fireEvent.keyDown(prompt, { key: "Enter" });
    const commandOverlay = await eventually(() => owned("overlay"));
    await eventually(() =>
      query(commandOverlay).getByRole("heading", {
        name: "Desktop meeting",
        level: 1,
      }),
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

test("Embedded Codex Desktop (26.1120): top entry sits below New chat & Bot above Pinned, projects match collapsed/flex headers, and ProseMirror /althing beats host keydown", async (t) => {
  dom(t);
  document.documentElement.lang = "zh-CN";
  const h = mockUI();
  const original = h.api.backend.invoke.bind(h.api.backend);
  const baseCards = (await original(
    "althing/topics/list",
  )) as import("../src/frontend/types").Card[];
  const items: typeof baseCards = [
    {
      ...baseCards[0],
      id: "council-althing",
      title: "Althing Plugin Arch",
      status: "completed",
      activeRunCount: 0,
      projectCwd: "/work/the-althing/packages",
      projectLabel: "packages",
    },
    {
      ...baseCards[0],
      id: "council-study",
      title: "Collapsed Study Council",
      status: "draft",
      activeRunCount: 0,
      projectCwd: "/projects/study",
      projectLabel: "Study",
    },
  ];
  let lastConveneParams: any = null;
  const backend = {
    invoke: async (method: string, p: any) => {
      if (method === "althing/topics/list") return items;
      if (method === "althing/codexhost/projects") {
        return {
          projects: [
            { cwd: "/work/the-althing", name: "the-althing" },
            { cwd: "/projects/study", name: "Study" },
          ],
          total: 2,
          nextOffset: null,
        };
      }
      if (method === "althing/codexhost/threads") {
        return {
          threads: [
            {
              thread: "codex://threads/pinned-uuid-1",
              cwd: "/work/the-althing",
            },
            {
              threadId: "local:proj-uuid-2",
              cwd: "/work/the-althing",
            },
          ],
        };
      }
      if (method === "althing/council/convene") {
        lastConveneParams = p;
      }
      if (method === "althing/events/since")
        return { cursor: 0, events: [], activeRunCount: 0 };
      return original(method, p);
    },
  };

  // Simulate Codex Desktop 26.1120 Chinese sidebar DOM:
  // Top nav ("新聊天", "Bot", "技能") above scroll area, then "置顶" (Pinned),
  // then an expanded project with a horizontal flex header bar + SVG icon + "+" button,
  // then a collapsed project with [data-sidebar-cycle-item] + leading <svg> and no rows.
  document.body.innerHTML = `
    <aside>
      <div class="top-nav">
        <button id="nav-new" type="button"><svg></svg><span>新聊天</span></button>
        <button id="nav-bot" type="button" style="font-size: 14px; min-height: 32px; border-radius: 8px;"><svg></svg><span>Bot</span></button>
        <button id="nav-skills" type="button"><svg></svg><span>技能</span></button>
      </div>
      <div data-app-action-sidebar-scroll>
        <section id="pinned-sec">
          <div class="section-header">置顶</div>
          <div role="list">
            <div role="listitem">
              <div id="pinned-row" data-app-action-sidebar-thread-row data-app-action-sidebar-thread-id="local:pinned-uuid-1">
                <span data-thread-title>Pinned thread</span>
              </div>
            </div>
          </div>
        </section>
        <section id="project-althing">
          <div id="althing-header-bar" style="display: flex; flex-direction: row;">
            <div id="althing-header" data-sidebar-cycle-item role="button" aria-expanded="true">
              <svg></svg><span>the-althing</span>
            </div>
            <button type="button" aria-label="New thread">+</button>
          </div>
          <div role="list">
            <div role="listitem">
              <div id="althing-row" data-app-action-sidebar-thread-row data-app-action-sidebar-thread-id="local:proj-uuid-2">
                <span data-thread-title>Project thread</span>
              </div>
            </div>
          </div>
        </section>
        <section id="project-study">
          <div id="study-header" data-sidebar-cycle-item role="button" aria-expanded="false">
            <svg></svg><span>Study</span>
          </div>
        </section>
      </div>
    </aside>
    <main>
      <div data-above-composer-conversation-id="proj-uuid-2"></div>
      <div data-codex-composer-root>
        <div class="ProseMirror" contenteditable="true" role="textbox"><p><span contenteditable="false" class="pm-widget"></span></p></div>
        <button type="submit" aria-label="发送"></button>
      </div>
    </main>
  `;

  const code = await readFile(
    new URL("../dist/desktop/index.js", import.meta.url),
    "utf8",
  );
  let definition: any;
  new Script("(function(define){" + code + "\n})").runInThisContext()(
    (d: any) => {
      definition = d;
    },
  );
  const { locale, onLocaleChange, ...desktopApi } = h.api;
  const dispose = definition.activate({
    ...desktopApi,
    backend,
    assets: { readDataUrl: h.api.assets.readDataUrl },
    dom: {
      mount: (
        e: Element,
        p: Element,
        key: "prepend" | "append" | "before" | "after" = "append",
      ) => p[key](e),
    },
    sidebar: {
      observeRows: (fn: Function) => {
        fn([
          {
            threadId: "pinned-uuid-1",
            isLocal: true,
            element: document.querySelector("#pinned-row"),
          },
          {
            threadId: "proj-uuid-2",
            isLocal: true,
            element: document.querySelector("#althing-row"),
          },
        ]);
        return () => {};
      },
    },
    navigate: { openThread: async () => {} },
    track: () => {},
  });

  const owned = (k: string) =>
    document.querySelector<HTMLElement>('[data-althing-owned="' + k + '"]');
  let hostDocumentKeydownSawSlash = false;
  const hostKeydownProbe = (e: KeyboardEvent) => {
    if (e.key === "Enter") hostDocumentKeydownSawSlash = true;
  };
  document.addEventListener("keydown", hostKeydownProbe, true);

  try {
    // 1. Top "议事厅" entry is visible by default (even with 0 active runs) and placed
    //    strictly AFTER "Bot" (below "新聊天" & "Bot") and ABOVE "置顶".
    const top = await eventually(() => owned("top"));
    assert.equal(top.textContent?.trim(), "议事厅");
    const navBot = document.querySelector("#nav-bot")!;
    const navSkills = document.querySelector("#nav-skills")!;
    assert.equal(navBot.nextElementSibling, top);
    assert.equal(top.nextElementSibling, navSkills);
    assert.equal(top.style.fontSize, "14px");

    // 2. Pinned section NEVER receives a project council group.
    assert.equal(
      document.querySelector('#pinned-sec [data-althing-owned="group"]'),
      null,
    );

    // 3. Expanded project "the-althing" receives its subdirectory council (/work/the-althing/packages)
    //    mounted vertically AFTER its horizontal flex header bar (not crushed inside it).
    const althingGroup = await eventually(() =>
      document.querySelector<HTMLElement>(
        '#project-althing [data-althing-owned="group"]',
      ),
    );
    assert.equal(
      document.querySelector("#althing-header-bar")!.nextElementSibling,
      althingGroup,
    );
    assert.match(althingGroup.textContent!, /议事厅 · 1/);

    // 4. Collapsed project "Study" (leading <svg>, no rows) ALSO receives its council group!
    const studyGroup = await eventually(() =>
      document.querySelector<HTMLElement>(
        '#project-study [data-althing-owned="group"]',
      ),
    );
    assert.equal(
      document.querySelector("#study-header")!.nextElementSibling,
      studyGroup,
    );
    assert.match(studyGroup.textContent!, /议事厅 · 1/);

    // 5. Clicking top "议事厅" opens overlay & marks aria-current="page"; clicking "新聊天" or "Bot" yields.
    fireEvent.click(top);
    await eventually(() => owned("overlay"));
    assert.equal(top.getAttribute("aria-current"), "page");
    fireEvent.click(document.querySelector("#nav-bot")!);
    await eventually(() => !owned("overlay"));
    assert.equal(top.getAttribute("aria-current"), null);

    fireEvent.click(top);
    await eventually(() => owned("overlay"));
    fireEvent.click(document.querySelector("#nav-new")!);
    await eventually(() => !owned("overlay"));

    // 6. ProseMirror composer WITH internal contenteditable="false" widget supports
    //    floating command pill (outside [data-codex-composer-root]), fullwidth ／althing,
    //    and intercepts Enter BEFORE CodexHost's document-capture keydown listener!
    const composer = document.querySelector("[data-codex-composer-root]")!;
    const pm = composer.querySelector<HTMLElement>(".ProseMirror")!;
    pm.innerHTML =
      '<p>／althing 嵌入桌面兼容测试<span contenteditable="false"></span></p>';
    fireEvent.input(pm);
    const pill = await eventually(() =>
      document.querySelector<HTMLButtonElement>("[data-althing-command]"),
    );
    assert.equal(composer.querySelector("[data-althing-command]"), null);
    assert.match(pill.textContent!, /回车直接召开议会/);

    fireEvent.keyDown(pm, { key: "Enter" });
    assert.equal(hostDocumentKeydownSawSlash, false);
    const overlay = await eventually(() => owned("overlay"));
    await eventually(() =>
      query(overlay).getByRole("heading", {
        name: "嵌入桌面兼容测试",
        level: 1,
      }),
    );
    assert.equal(pm.textContent?.trim(), "");
    assert.equal(lastConveneParams?.cwd, "/work/the-althing");
  } finally {
    document.removeEventListener("keydown", hostKeydownProbe, true);
    dispose();
  }
});
