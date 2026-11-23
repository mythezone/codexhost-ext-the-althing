import { councilFixture, contribution, dispatch, fixture } from "./helpers";
import { hydrate, topicSummary } from "../src/backend/domain/council";
import { mockHost } from "./mock-host";
import { RpcClient } from "../src/frontend/rpc-client";
import test from "node:test";
import assert from "node:assert/strict";
import {
  dom,
  mockUI,
  eventually,
  query,
  fireEvent,
  within,
  wait,
} from "./ui-host";
import type { HostApi } from "../src/frontend/host";
async function mount(root: HTMLElement, api: HostApi) {
  const module = await import(
    new URL("../dist/page/index.mjs", import.meta.url).href
  );
  return module.mount(root, api) as Promise<() => void>;
}
test("Hub filters projects, scopes themes, and follows Host locale without changing navigation", async (t) => {
  dom(t);
  const h = mockUI(),
    root = document.createElement("section");
  document.body.append(root);
  document.documentElement.dataset.theme = "host";
  const original = locationHref();
  const dispose = await mount(root, h.api);
  try {
    const ui = await eventually(() => query(root));
    await eventually(() => ui.getByText("Another project"));
    fireEvent.change(ui.getByLabelText("Project filter"), {
      target: { value: "/projects/study" },
    });
    await eventually(() => !ui.queryByText("Another project"));
    assert.ok(ui.getByText("Research council"));
    fireEvent.change(ui.getByLabelText("Search councils"), {
      target: { value: "nonesuch" },
    });
    await eventually(() => ui.getByText("No councils match this view."));
    for (const fn of h.schemes) fn("dark");
    const container =
      root.firstElementChild!.shadowRoot!.querySelector(".althing-ext-root")!;
    await eventually(
      () => container.getAttribute("data-theme") === "obsidian-night",
    );
    fireEvent.change(ui.getByLabelText("Theme"), {
      target: { value: "cool-slate" },
    });
    await eventually(
      () => container.getAttribute("data-theme") === "cool-slate",
    );
    for (const fn of h.languages) fn("zh-CN");
    await eventually(() => ui.getByRole("button", { name: "新建议题" }));
    assert.equal(document.documentElement.dataset.theme, "host");
    assert.equal(original, locationHref());
  } finally {
    dispose();
  }
  assert.equal(h.languages.size + h.schemes.size + h.listeners.size, 0);
  assert.equal(root.children.length, 0);
});
function locationHref() {
  return window.location.href;
}
test("New Council wizard uses workspace, advertised fast model, supported thinking, moderator and nested agendas", async (t) => {
  dom(t);
  const h = mockUI(),
    root = document.createElement("div");
  document.body.append(root);
  const dispose = await mount(root, h.api);
  try {
    const ui = await eventually(() => query(root));
    fireEvent.click(
      await eventually(() => ui.getByRole("button", { name: "New Council" })),
    );
    const wizard = within(await eventually(() => ui.getByRole("dialog")));
    const field = async (label: string, value: string) =>
      fireEvent.change(await eventually(() => wizard.getByLabelText(label)), {
        target: { value },
      });
    await field("Title", "Methods review");
    await field("Project workspace", "/projects/study");
    assert.equal(
      (wizard.getByLabelText("Discussion protocol") as HTMLSelectElement).value,
      "rapid-panel",
    );
    fireEvent.click(wizard.getByText("Continue"));
    fireEvent.click(
      await eventually(() => wizard.getByText("Add expert", { exact: false })),
    );
    await field("Display name", "Reviewer");
    await field("Research role", "Analyst");
    await field("Harness", "codex");
    await eventually(() => wizard.getByRole("option", { name: /Fast/ }));
    await field("Model", "sol~fast");
    await field("Thinking level", "high");
    await eventually(() => !wizard.queryByRole("option", { name: "low" }));
    fireEvent.click(wizard.getByLabelText("Configure moderator"));
    const chair = await eventually(
      () => wizard.getAllByLabelText("Harness")[1],
    );
    fireEvent.change(chair, { target: { value: "other" } });
    fireEvent.click(wizard.getByText("Continue"));
    fireEvent.click(
      await eventually(() => wizard.getByText("Add agenda", { exact: false })),
    );
    await field("Agenda title", "Method");
    fireEvent.click(wizard.getByText("Add sub-agenda", { exact: false }));
    await field("Sub-agenda title", "Evidence");
    await field("Execution", "sequential");
    fireEvent.click(wizard.getByRole("button", { name: "Create council" }));
    const data = (
      await eventually(() => h.calls.find((x) => x.method === "topics/create"))
    ).p.data;
    assert.equal(data.metadata.codexhost.project_cwd, "/projects/study");
    assert.equal(data.metadata.codexhost.moderator_config.harnessId, "other");
    assert.deepEqual(
      data.metadata.codexhost.panelist_threads[data.panelists[0].id],
      { harnessId: "codex", model: { id: "sol~fast" }, thinking: "high" },
    );
    assert.equal(data.agendas[0].sub_agendas[0].execution_mode, "sequential");
    await eventually(() =>
      ui.getByRole("heading", { name: "Methods review", level: 1 }),
    );
  } finally {
    dispose();
  }
});
test("reading overview, dispatch, run controls, report sandbox, archive import and export", async (t) => {
  dom(t);
  const h = mockUI(),
    root = document.createElement("div");
  document.body.append(root);
  const dispose = await mount(root, h.api);
  try {
    const ui = await eventually(() => query(root));
    const input = await eventually(() => ui.getByLabelText("Archive file"));
    fireEvent.change(input, {
      target: { files: [new File(["abc"], "archive.zip")] },
    });
    await eventually(() =>
      h.calls.some((x) => x.method === "archives/import-commit"),
    );
    await eventually(() => ui.getByRole("heading", { name: "Council brief" }));
    assert.equal(ui.queryByRole("button", { name: "Venue view" }), null);
    fireEvent.click(
      await eventually(() =>
        root.firstElementChild?.shadowRoot?.querySelector(".agenda-link"),
      ),
    );
    fireEvent.click(
      await eventually(() =>
        ui.getByRole("button", { name: "Dispatch round" }),
      ),
    );
    const dialog = within(await eventually(() => ui.getByRole("dialog")));
    fireEvent.change(dialog.getByLabelText("Round type"), {
      target: { value: "critique" },
    });
    assert.match(
      (dialog.getByLabelText("Public prompt") as HTMLTextAreaElement).value,
      /strongest supported/,
    );
    fireEvent.change(dialog.getByLabelText("Public prompt"), {
      target: { value: "Evaluate the evidence." },
    });
    fireEvent.click(dialog.getByRole("button", { name: "Send round" }));
    const sent = (
      await eventually(() =>
        h.calls.find((c) => c.method === "council/dispatch-round"),
      )
    ).p;
    assert.equal(sent.prompt_full, "Evaluate the evidence.");
    assert.equal(sent.round_type, "critique");
    assert.deepEqual(sent.target_panelist_ids, ["p1", "p2"]);
    await eventually(() => !ui.queryByRole("dialog"));
    fireEvent.click(
      await eventually(() => {
        const b = ui.getByRole("button", {
          name: "Cancel",
        }) as HTMLButtonElement;
        return b.disabled ? null : b;
      }),
    );
    fireEvent.click(
      await eventually(() => ui.getByRole("button", { name: "Retry" })),
    );
    await eventually(() =>
      h.calls.some((c) => c.method === "council/retry-run"),
    );
    fireEvent.click(ui.getByRole("button", { name: "Open Thread" }));
    assert.equal(
      (
        (await eventually(() =>
          ui.getByLabelText("Thread link"),
        )) as HTMLInputElement
      ).value,
      "codex://threads/thread1",
    );
    fireEvent.click(ui.getByLabelText("Close"));
    fireEvent.click(ui.getByRole("button", { name: "Final reports" }));
    fireEvent.click(
      await eventually(() => ui.getByRole("button", { name: /Field report/ })),
    );
    const frame = await eventually(
      () => ui.getByTitle("Field report") as HTMLIFrameElement,
    );
    assert.equal(frame.getAttribute("sandbox"), "allow-scripts allow-modals");
    assert.match(frame.srcdoc, /Content-Security-Policy/i);
    assert.ok(ui.getByRole("button", { name: "Print / PDF" }));
    fireEvent.click(ui.getByLabelText("Close"));
    fireEvent.click(ui.getByText("Council actions"));
    fireEvent.click(ui.getByRole("button", { name: "Create archive" }));
    await eventually(() => h.calls.some((x) => x.method === "archives/create"));
    await wait(30);
    fireEvent.click(ui.getByRole("button", { name: "Export archive-zip" }));
    await eventually(() =>
      h.calls.some(
        (c) => c.method === "transfers/release" && c.p.transferId === "d",
      ),
    );
  } finally {
    dispose();
  }
});

test("built page dispatches through the built backend and receives completed contributions via live events", async (t) => {
  dom(t);
  const host = await mockHost(t),
    uiHost = mockUI(),
    handlers = new Map<string, (p: unknown) => Promise<unknown>>();
  const mod = await import(
    new URL("../dist/backend/index.mjs", import.meta.url).href
  );
  const backend = await mod.activate({
    dataDir: host.dataDir,
    readSettings: async () => ({}),
    handle: (name: string, fn: (p: unknown) => Promise<unknown>) =>
      handlers.set(name, fn),
  });
  const api = {
    ...uiHost.api,
    backend: {
      invoke: async (name: string, p: unknown) => handlers.get(name)!(p),
    },
  };
  const root = document.createElement("main");
  document.body.append(root);
  let dispose = () => {};
  try {
    await new RpcClient(api.backend).call("topics/create", { data: fixture });
    dispose = await mount(root, api);
    const ui = await eventually(() => query(root));
    fireEvent.click(
      await eventually(() => ui.getByRole("button", { name: "Enter council" })),
    );
    fireEvent.click(
      await eventually(() =>
        root.firstElementChild?.shadowRoot?.querySelector(".agenda-link"),
      ),
    );
    fireEvent.click(
      await eventually(() =>
        ui.getByRole("button", { name: "Dispatch round" }),
      ),
    );
    const dialog = within(await eventually(() => ui.getByRole("dialog")));
    fireEvent.click(dialog.getByRole("button", { name: "Send round" }));
    await eventually(() => host.threads.size === 2, 10000);
    for (const [i, id] of [...host.threads.keys()].entries())
      host.finish(
        id,
        "Finding " +
          i +
          " from the mock Host.\n\n- First observation\n- Second observation\n- Third observation",
      );
    await eventually(
      () => ui.queryAllByText(/Finding [01] from the mock Host/).length >= 2,
      15000,
    );
    assert.equal(ui.queryAllByText("completed").length >= 2, true);
    assert.equal(host.routes("delegate/start").length, 2);
  } finally {
    dispose();
    await backend.dispose();
  }
});

test("a collapsed fold never parses Markdown and remounting reuses sanitized HTML", async (t) => {
  dom(t);
  const { marked } = await import("marked");
  const parser = t.mock.method(marked, "parse");
  const { createRoot } = await import("react-dom/client");
  const { Fold, Markdown } = await import("../src/frontend/ui");
  const host = document.createElement("div");
  document.body.append(host);
  const react = createRoot(host);
  try {
    react.render(
      <Fold summary="Expand">
        <Markdown text="**Cache probe**" />
      </Fold>,
    );
    const button = await eventually(() => host.querySelector("button"));
    assert.equal(parser.mock.callCount(), 0);
    for (let i = 0; i < 2; i++) {
      fireEvent.click(button);
      await eventually(
        () => host.querySelector("strong")?.textContent === "Cache probe",
      );
      assert.equal(parser.mock.callCount(), 1);
      assert.equal(button.getAttribute("aria-expanded"), "true");
      fireEvent.click(button);
      await eventually(() => !host.querySelector(".prose"));
    }
  } finally {
    react.unmount();
    await wait(30);
  }
});

test("topic shell, prefetched snapshot, on-demand critique and fold bodies, print and same-topic navigation", async (t) => {
  dom(t);
  const h = mockUI(),
    c = councilFixture();
  c.create("dispatch", dispatch, "s");
  c.create("contribution", contribution, "s");
  const reads: unknown[] = [],
    bodies: string[] = [];
  const firstRead = Promise.withResolvers<void>();
  const firstBody = Promise.withResolvers<void>();
  const normal = h.api.backend.invoke.bind(h.api.backend);
  const api = {
    ...h.api,
    backend: {
      invoke: async (name: string, p: any) => {
        if (name === "althing/topics/get") {
          reads.push(p.summaryOnly);
          await firstRead.promise;
          return p.summaryOnly ? topicSummary(c.tree) : hydrate(c.tree);
        }
        if (name === "althing/topics/body") {
          bodies.push(p.kind);
          await firstBody.promise;
          return {
            text:
              p.kind === "contribution"
                ? contribution.full_content
                : dispatch.prompt_full,
          };
        }
        return normal(name, p);
      },
    },
  };
  const realMatch = window.matchMedia.bind(window);
  t.mock.method(window, "matchMedia", (media: string) =>
    media === "(hover: hover)" ? { matches: true } : realMatch(media),
  );
  const host = document.createElement("div");
  document.body.append(host);
  const dispose = await mount(host, api);
  try {
    const ui = await eventually(() => query(host));
    const enter = await eventually(
      () => ui.getAllByRole("button", { name: "Enter council" })[0],
    );
    fireEvent.focusIn(enter);
    await eventually(() => reads.length === 1);
    fireEvent.click(enter);
    await eventually(() =>
      ui.getByRole("heading", { name: fixture.title, level: 1 }),
    );
    assert.ok(ui.getByRole("status", { name: "Loading council…" }));
    assert.ok(ui.getByText(fixture.subtitle));
    assert.ok(ui.getByText("science"));
    firstRead.resolve();
    const shadow = host.firstElementChild!.shadowRoot!;
    fireEvent.click(
      await eventually(() => shadow.querySelector(".agenda-link")),
    );
    const heading = await eventually(() =>
      ui.getByRole("heading", { name: fixture.title, level: 1 }),
    );
    const fold = await eventually(() =>
      ui.getByRole("button", { name: "Read full text (12)" }),
    );
    assert.equal(shadow.querySelectorAll(".reveal .prose").length, 0);
    assert.deepEqual(bodies, []);
    assert.deepEqual(reads, [true]);

    fireEvent.click(ui.getByRole("button", { name: "Dispatch round" }));
    const dialog = within(await eventually(() => ui.getByRole("dialog")));
    fireEvent.change(dialog.getByLabelText("Round type"), {
      target: { value: "critique" },
    });
    fireEvent.click(dialog.getByRole("checkbox", { name: /One · Lead/ }));
    await eventually(() => bodies.length === 1);
    assert.ok(
      (dialog.getByRole("button", { name: "Send round" }) as HTMLButtonElement)
        .disabled,
    );
    firstBody.resolve();
    await eventually(() =>
      (
        dialog.getByLabelText("Public prompt") as HTMLTextAreaElement
      ).value.includes(contribution.full_content),
    );
    fireEvent.click(dialog.getByLabelText("Close"));
    for (let i = 0; i < 2; i++) {
      fireEvent.click(fold);
      await eventually(() => ui.getByText(contribution.full_content));
      fireEvent.click(fold);
      await eventually(() => !shadow.querySelector(".response .reveal .prose"));
    }
    assert.deepEqual(bodies, ["contribution"]);
    const prompt = ui.getByRole("button", { name: "Show full prompt" });
    fireEvent.click(prompt);
    await eventually(() => ui.getByText(dispatch.prompt_full));
    fireEvent.click(prompt);
    assert.deepEqual(bodies, ["contribution", "dispatch"]);

    host.dispatchEvent(
      new CustomEvent("althing:navigate", {
        detail: { topicId: "study", tab: "a", sub: "s2" },
      }),
    );
    await eventually(
      () =>
        shadow.querySelector(".discussion-title")?.textContent === "Comparison",
    );
    assert.equal(
      ui.getByRole("heading", { name: fixture.title, level: 1 }),
      heading,
    );
    fireEvent.click(ui.getByRole("button", { name: "Councils" }));
    fireEvent.click(
      await eventually(
        () => ui.getAllByRole("button", { name: "Enter council" })[0],
      ),
    );
    await eventually(() => ui.getByRole("heading", { name: "Council brief" }));
    assert.deepEqual(reads, [true]);
    fireEvent.click(
      await eventually(() => shadow.querySelector(".agenda-link")),
    );
    await eventually(() =>
      ui.getByRole("button", { name: "Read full text (12)" }),
    );
    const print = t.mock.fn(() => {
      assert.equal(
        shadow.querySelector(".response .reveal .prose")?.textContent?.trim(),
        contribution.full_content,
      );
      assert.equal(
        shadow.querySelector(".dispatch .reveal .prose")?.textContent?.trim(),
        dispatch.prompt_full,
      );
    });
    window.print = print;
    fireEvent.click(ui.getByRole("button", { name: "Print agenda" }));
    await eventually(() => print.mock.callCount() === 1);
    assert.equal(reads[1], undefined);
    assert.ok(reads.length >= 2);
    assert.equal(print.mock.calls[0].error, undefined);
    window.dispatchEvent(new Event("afterprint"));
    await eventually(() => !shadow.querySelector(".reveal .prose"));
  } finally {
    firstRead.resolve();
    firstBody.resolve();
    dispose();
  }
});

test("an event refreshes the cached topic without replacing the current workspace", async (t) => {
  dom(t);
  const h = mockUI();
  const normal = h.api.backend.invoke.bind(h.api.backend);
  const tree = councilFixture().tree;
  const resume = Promise.withResolvers<void>();
  let changed = false,
    reads = 0;
  const api = {
    ...h.api,
    backend: {
      invoke: async (name: string, p: any) => {
        if (name === "althing/topics/get") {
          if (++reads > 1) await resume.promise;
          return topicSummary(tree);
        }
        if (changed && name === "althing/events/since") {
          changed = false;
          return {
            cursor: 1,
            truncated: false,
            events: [{ topic_id: tree.id }],
            activeRunCount: 0,
          };
        }
        return normal(name, p);
      },
    },
  };
  const host = document.createElement("div");
  document.body.append(host);
  const dispose = await mount(host, api);
  try {
    const ui = await eventually(() => query(host));
    fireEvent.click(
      await eventually(
        () => ui.getAllByRole("button", { name: "Enter council" })[0],
      ),
    );
    await eventually(() => ui.getByRole("heading", { name: "Council brief" }));
    const heading = ui.getByRole("heading", { name: fixture.title, level: 1 });
    tree.title = "Revised council";
    changed = true;
    document.dispatchEvent(new Event("visibilitychange"));
    await eventually(() => reads === 2);
    assert.equal(
      ui.getByRole("heading", { name: fixture.title, level: 1 }),
      heading,
    );
    assert.equal(ui.queryByRole("status", { name: "Loading council…" }), null);
    resume.resolve();
    await eventually(
      () => ui.getByRole("heading", { name: tree.title, level: 1 }) === heading,
    );
  } finally {
    resume.resolve();
    dispose();
  }
});
