import { Window } from "happy-dom";
import { fireEvent, within } from "@testing-library/dom";
import { setTimeout as wait } from "node:timers/promises";
import assert from "node:assert/strict";
import { councilFixture } from "./helpers";
import { hydrate, toCard, Council } from "../src/backend/domain/council";
import type { Topic } from "../src/backend/domain/models";
import { recommendPanel } from "../src/backend/smart-panel";
import { splitPrompt } from "../src/shared/command";
import { resolveLocale } from "../src/shared/i18n";
import type { Agent } from "../src/shared/agents";
import type { Run } from "../src/backend/orchestrator";
import type { TestContext } from "node:test";
export { fireEvent, within, wait };
export function dom(t: TestContext) {
  const win = new Window({
    url: "http://localhost/",
    settings: {
      disableCSSFileLoading: true,
      disableJavaScriptFileLoading: true,
    },
  });
  const keys = [
    "window",
    "document",
    "navigator",
    "HTMLElement",
    "Element",
    "Node",
    "HTMLInputElement",
    "HTMLTextAreaElement",
    "Event",
    "CustomEvent",
    "MouseEvent",
    "MutationObserver",
    "ResizeObserver",
    "DOMParser",
    "CSS",
    "localStorage",
    "requestAnimationFrame",
    "cancelAnimationFrame",
    "getComputedStyle",
  ] as const;
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key),
      value = key === "window" ? win : win[key as keyof Window];
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value: [
        "getComputedStyle",
        "requestAnimationFrame",
        "cancelAnimationFrame",
      ].includes(key)
        ? (value as Function).bind(win)
        : value,
    });
    t.after(() => {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    });
  }
  t.after(() => win.happyDOM.close());
  return win;
}
export async function eventually<T>(
  read: () => T,
  timeout = 2000,
): Promise<NonNullable<T>> {
  const end = Date.now() + timeout;
  while (true) {
    try {
      const v = read();
      assert.ok(v);
      return v;
    } catch (e) {
      if (Date.now() > end) throw e;
      await wait(12);
    }
  }
}
export function mockUI() {
  const c = councilFixture();
  c.create(
    "report",
    {
      title: "Field report",
      id: "report",
      markdown_content: "# Result\nEvidence.",
    },
    "study",
  );
  let topic = hydrate(c.tree),
    runs: Run[] = [
      {
        id: "r",
        topicId: "study",
        subAgendaId: "s",
        panelistId: "p1",
        threadId: "thread1",
        harnessId: "codex",
        model: { id: "gpt" },
        thinking: "high",
        status: "running",
        kind: "panelist",
        startedAt: "now",
        updatedAt: "now",
        progressText: "Reviewing evidence",
      },
    ];
  const topics = new Map<string, { council: Council; topic: Topic; runs: Run[] }>([
    [topic.id, { council: c, topic, runs }],
  ]);
  const other = {
    ...toCard(c.tree),
    id: "other",
    title: "Another project",
    projectCwd: "/other",
    projectLabel: "Other",
  };
  const calls: { method: string; p: any }[] = [],
    settings = {
      showProjectAlthingItems: true,
      defaultTheme: "auto",
      defaultProtocol: "rapid-panel",
      autoStartCouncil: true,
    };
  const mockAgents: Agent[] = ["codex", "other", "missing"].map((id) => ({
    id,
    label: id === "codex" ? "Codex" : id,
    section: "auto",
    configuredForDelegation: id === "codex",
    status: id === "missing" ? "unavailable" : "ready",
    statusMessage: id === "missing" ? "Login required" : "",
    defaultModel: { id: "sol" },
    defaultThinking: "high",
    defaultThinkingLabel: "High",
    models: [
      {
        label: "Sol",
        resolvedModelLabel: "",
        ref: { id: "sol" },
        fastModel: { id: "sol~fast" },
        supportedThinkingOptionIds: ["high"],
      },
      {
        label: "Lite",
        resolvedModelLabel: "",
        ref: { id: "lite" },
        fastModel: null,
        supportedThinkingOptionIds: ["low"],
      },
    ],
    thinkingOptions: [
      { id: "high", label: "High" },
      { id: "low", label: "Low" },
    ],
  }));
  const listeners = new Set<(v: any) => void>(),
    languages = new Set<(v: string) => void>(),
    schemes = new Set<(v: string) => void>(),
    controller = new AbortController();
  function subscribe<T>(set: Set<(v: T) => void>) {
    return (fn: (v: T) => void) => {
      set.add(fn);
      return () => {
        set.delete(fn);
      };
    };
  }
  const api = {
    signal: controller.signal,
    locale: "en",
    colorScheme: "light",
    onLocaleChange: subscribe(languages),
    onColorSchemeChange: subscribe(schemes),
    assets: {
      url: (path: string) => "/extension/" + path,
      readDataUrl: async () => ({
        dataUrl: "data:image/webp;base64,AA==",
        mimeType: "image/webp",
      }),
    },
    storage: { get: async () => settings, onChange: subscribe(listeners) },
    backend: {
      async invoke(name: string, p: any = {}) {
        const method = name.slice("althing/".length);
        calls.push({ method, p });
        switch (method) {
          case "codexhost/status":
            return { connected: true };
          case "codexhost/threads":
            return {
              threads: [{ threadId: "thread1", cwd: "/projects/study" }],
            };
          case "codexhost/projects":
            return {
              projects: [
                { cwd: "/projects/study", name: "Study" },
                { cwd: "/other", name: "Other" },
              ],
            };
          case "codexhost/agents":
            return { agents: mockAgents };
          case "council/recommend-panel":
            return recommendPanel({
              prompt: p.prompt,
              agents: mockAgents,
              workspace: p.cwd || "/projects/study",
              workspaceLabel: p.cwd ? p.cwd.split(/[\\/]/).filter(Boolean).pop() : "Study",
              protocol: p.protocol,
              defaultProtocol: settings.defaultProtocol as "rapid-panel",
              expertCount: p.expertCount,
              locale: resolveLocale(p.locale),
            });
          case "council/convene": {
            const split = splitPrompt(String(p.prompt ?? ""));
            const title = (p.title || split.title || "").trim();
            const workspace = p.cwd || "/projects/study";
            const customPanel = Array.isArray(p.panelists) && p.panelists.length > 0;
            const rec = customPanel
              ? null
              : recommendPanel({
                  prompt: p.prompt || title,
                  agents: mockAgents,
                  workspace,
                  workspaceLabel:
                    workspace.split(/[\\/]/).filter(Boolean).pop() || "Study",
                  protocol: p.protocol,
                  defaultProtocol: settings.defaultProtocol as "rapid-panel",
                  expertCount: p.expertCount,
                  locale: resolveLocale(p.locale),
                });
            const shouldPlan =
              p.planWithAi !== false && !(Array.isArray(p.agendas) && p.agendas.length > 0);
            const planRun: Run | null = shouldPlan
              ? {
                  id: "plan-1",
                  topicId: "",
                  kind: "plan",
                  threadId: "plan-thread",
                  harnessId:
                    (customPanel
                      ? p.host?.moderator_config?.harnessId
                      : rec?.host.moderator_config?.harnessId) || "codex",
                  model: { id: "sol" },
                  thinking: "high",
                  status: "running",
                  startedAt: "now",
                  updatedAt: "now",
                  progressText: "Planning agendas",
                }
              : null;
            const next = new Council();
            next.create("topic", {
              title,
              subtitle: p.subtitle ?? "",
              description: p.description ?? split.description,
              domain_tags: p.domain_tags ?? [],
              protocol_id:
                p.protocol ?? rec?.protocol ?? settings.defaultProtocol,
              status: shouldPlan ? "in_progress" : "draft",
              panelists: customPanel ? p.panelists : rec?.panelists ?? [],
              moderator: customPanel ? p.moderator ?? {} : rec?.moderator ?? {},
              agendas: Array.isArray(p.agendas) ? p.agendas : [],
              metadata: {
                codexhost: {
                  project_cwd: workspace,
                  project_label:
                    workspace.split(/[\\/]/).filter(Boolean).pop() || "Study",
                  ...(customPanel ? p.host ?? {} : rec?.host ?? {}),
                  auto_dispatch: Boolean(shouldPlan && p.autoDispatch !== false),
                  auto_assign_roles: Boolean(shouldPlan && !customPanel),
                  runs: [],
                },
              },
            });
            if (planRun) {
              planRun.topicId = next.tree.id;
              ((next.tree.metadata.codexhost as Record<string, unknown>).runs as Run[]).push(
                planRun,
              );
            }
            topic = hydrate(next.tree);
            runs = planRun ? [planRun] : [];
            topics.set(topic.id, { council: next, topic, runs });
            return { topic, planRun, recommendation: rec };
          }
          case "council/set-auto-dispatch": {
            const entry = topics.get(p.topicId) ?? { council: c, topic, runs };
            const meta = (entry.topic.metadata.codexhost || {}) as Record<string, unknown>;
            meta.auto_dispatch = Boolean(p.enabled);
            entry.topic = {
              ...entry.topic,
              metadata: {
                ...entry.topic.metadata,
                codexhost: { ...meta } as typeof entry.topic.metadata.codexhost,
              },
            };
            if (entry.topic.id === topic.id) topic = entry.topic;
            return { auto_dispatch: Boolean(p.enabled) };
          }
          case "codexhost/harnesses":
            return { harnesses: ["codex", { id: "other" }] };
          case "codexhost/harness-inspect":
            return {
              inspection: {
                catalog: {
                  models: [
                    {
                      label: "Sol",
                      ref: { id: "sol" },
                      fastModel: { id: "sol~fast" },
                      supportedThinkingOptionIds: ["high"],
                    },
                  ],
                  thinkingOptions: [{ id: "high" }, { id: "low" }],
                },
              },
            };
          case "topics/list":
            return [{ ...toCard(c.tree), activeRunCount: 1 }, other];
          case "topics/get":
            return topics.get(p.topicId)?.topic ?? topic;
          case "topics/update": {
            const entry = topics.get(p.topicId) ?? { council: c, topic, runs };
            entry.council.patch("topic", entry.topic.id, p.patch);
            entry.topic = hydrate(entry.council.tree);
            if (entry.topic.id === topic.id) topic = entry.topic;
            return entry.topic;
          }
          case "topics/create": {
            const next = new Council();
            next.create("topic", p.data);
            topic = hydrate(next.tree);
            runs = [];
            topics.set(topic.id, { council: next, topic, runs });
            return topic;
          }
          case "events/since":
            return {
              cursor: 0,
              activeRunCount: 0,
              truncated: false,
              events: [],
            };
          case "council/runs":
            return topics.get(p.topicId)?.runs ?? runs;
          case "council/cancel-run": {
            const entry = topics.get(p.topicId);
            if (entry) {
              entry.runs = entry.runs.map((r) => ({ ...r, status: "cancelled" }));
              if (entry.topic.id === topic.id) runs = entry.runs;
            } else {
              runs = runs.map((r) => ({ ...r, status: "cancelled" }));
            }
            return true;
          }
          case "council/retry-run": {
            const entry = topics.get(p.topicId);
            if (entry) {
              entry.runs = entry.runs.map((r) => ({ ...r, status: "running" }));
              if (entry.topic.id === topic.id) runs = entry.runs;
            } else {
              runs = runs.map((r) => ({ ...r, status: "running" }));
            }
            return true;
          }
          case "reports/get":
            return c.get("report", "report");
          case "archives/import-begin":
            return { uploadId: "up", totalChunks: 1 };
          case "archives/import-commit":
            return { topicId: "study" };
          case "exports/download-chunk":
            return {
              totalBytes: 3,
              totalChunks: 1,
              chunkIndex: 0,
              downloadId: "d",
              base64: "YWJj",
              fileName: "c.zip",
              mimeType: "application/zip",
            };
          case "transfers/release":
          case "archives/import-chunk":
          case "council/dispatch-round":
          case "archives/create":
            return true;
          default:
            throw Error("Unexpected test method " + method);
        }
      },
    },
  };
  return { api, calls, listeners, languages, schemes, controller, settings };
}
export function query(root: HTMLElement) {
  const app =
    root.firstElementChild?.shadowRoot?.querySelector<HTMLElement>(
      ".althing-ext-root",
    );
  assert.ok(app);
  return within(app.parentElement!);
}
