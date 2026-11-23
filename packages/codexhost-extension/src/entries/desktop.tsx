import { mountWorkspace } from "../frontend/App";
import {
  listenAppearance,
  activeCouncil,
  workspaceKey,
  type Destination,
  type HostApi,
  type Project,
} from "../frontend/host";
import { RpcClient, watchEvents } from "../frontend/rpc-client";
import type { Card } from "../frontend/types";
type Row = { element: HTMLElement; threadId: string | null; isLocal: boolean };
type Desktop = HostApi & {
  dom: {
    mount: (
      el: Element,
      parent: Element,
      position?: "prepend" | "append" | "after",
    ) => void;
  };
  sidebar: { observeRows: (cb: (rows: readonly Row[]) => void) => () => void };
  navigate: { openThread: (id: string) => Promise<void> };
  track: (fn: () => void) => void;
};
declare const define: (extension: {
  activate: (api: Desktop) => () => void;
}) => void;
const sidebar = "[data-app-action-sidebar-scroll]",
  rail = "nav[data-app-navigation-rail]",
  owned = "[data-althing-owned]";
const projectSelector =
  "[data-app-action-sidebar-project-row],[data-project-cwd],[data-project-path],[data-app-action-sidebar-project],[data-app-action-sidebar-project-collapsed],[data-app-action-sidebar-project-id]";
const rowSelector =
  "[data-app-action-sidebar-thread-row],[data-app-action-sidebar-thread-id]";
const foreign = [
  "children",
  "toggle",
  "expand",
  "summary",
  "virtual",
  "motion",
  "node",
  "action",
]
  .map((k) => "[data-codexhost-sidebar-tree-" + k + "]")
  .join(",");
function element<K extends keyof HTMLElementTagNameMap>(tag: K, kind: string) {
  const el = document.createElement(tag);
  el.dataset.althingOwned = kind;
  return el;
}
function icon() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"),
    path = document.createElementNS(svg.namespaceURI, "path");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "17");
  svg.setAttribute("height", "17");
  svg.setAttribute("aria-hidden", "true");
  path.setAttribute(
    "d",
    "M2 8 12 3l10 5v2H2zm3 4h3v7H5zm6 0h2v7h-2zm5 0h3v7h-3zM2 21h20v2H2z",
  );
  path.setAttribute("fill", "currentColor");
  svg.append(path);
  return svg;
}
function activate(api: Desktop) {
  const ctrl = new AbortController(),
    rpc = new RpcClient(api.backend, ctrl.signal);
  let groupsEnabled = true,
    english = true,
    rows: readonly Row[] = [],
    cards: Card[] = [],
    projects: Project[] = [],
    threads = new Map<string, string>();
  const groups = new Map<Element, { box: HTMLElement; signature: string }>(),
    expanded = new Map<string, boolean>();
  let overlay: HTMLElement | undefined,
    unmount: (() => void) | undefined,
    resize: ResizeObserver | undefined,
    frame = 0,
    measured: Element[] = [],
    known: Project[] = [];
  const top = element("button", "top");
  top.type = "button";
  const topText = document.createElement("span"),
    pill = document.createElement("small");
  top.append(icon(), topText, pill);
  const translate = (en: string, zh: string) => (english ? en : zh);
  function close() {
    resize?.disconnect();
    measured = [];
    resize = undefined;
    unmount?.();
    unmount = undefined;
    overlay?.remove();
    overlay = undefined;
  }
  function place() {
    if (!overlay) return;
    const scroll = document.querySelector(sidebar),
      nodes = [
        scroll?.closest("aside") || scroll,
        document.querySelector(rail),
      ].filter((n): n is Element => !!n);
    if (
      nodes.length !== measured.length ||
      nodes.some((n, i) => n !== measured[i])
    ) {
      resize?.disconnect();
      for (const n of nodes) resize?.observe(n);
      measured = nodes;
    }
    const bounds = nodes
      .map((n) => n.getBoundingClientRect())
      .filter((b) => b.width > 0 && b.height > 0);
    overlay.style.left = Math.max(0, ...bounds.map((b) => b.right)) + "px";
    overlay.style.top =
      Math.max(
        0,
        Math.min(...(bounds.length ? bounds.map((b) => b.top) : [0])),
      ) + "px";
  }
  function open(destination: Destination) {
    if (overlay) {
      overlay.dispatchEvent(
        new CustomEvent("althing:navigate", { detail: destination }),
      );
      return;
    }
    overlay = element("section", "overlay");
    api.dom.mount(overlay, document.body);
    if (typeof ResizeObserver !== "undefined")
      resize = new ResizeObserver(place);
    place();
    unmount = mountWorkspace(overlay, api, {
      initial: destination,
      projects: () => known,
      close,
      openThread: async (id) => {
        close();
        await api.navigate.openThread(id);
      },
    });
  }
  top.onclick = () => open({});
  function saved(cwd: string) {
    try {
      return localStorage.getItem("the-althing.project." + cwd) === "open";
    } catch {
      return false;
    }
  }
  function update() {
    frame = 0;
    if (ctrl.signal.aborted) return;
    place();
    const scroll = document.querySelector(sidebar),
      parent = scroll || document.querySelector(rail);
    if (!parent) {
      top.remove();
      for (const { box } of groups.values()) box.remove();
      groups.clear();
      return;
    }
    if (top.parentElement !== parent) api.dom.mount(top, parent, "prepend");
    const title = translate("The Althing", "议事厅"),
      n = cards.filter(activeCouncil).length;
    if (topText.textContent !== title) topText.textContent = title;
    if (pill.hidden !== !n) pill.hidden = !n;
    if (pill.textContent !== String(n)) pill.textContent = String(n);
    pill.title = translate("Active councils", "活跃议题");
    const catalog = new Map<string, Project>();
    for (const c of cards)
      if (c.projectCwd)
        catalog.set(workspaceKey(c.projectCwd), {
          cwd: c.projectCwd,
          name: c.projectLabel || c.projectCwd.split(/[\\/]/).pop()!,
        });
    for (const p of projects) catalog.set(workspaceKey(p.cwd), p);
    const candidates = new Map<Element, Project>();
    function match(node: Element, cwd?: string) {
      if (
        candidates.has(node) ||
        node.closest(owned + "," + foreign) ||
        node.matches(rowSelector)
      )
        return;
      const path =
        cwd ||
        [
          "data-project-cwd",
          "data-project-path",
          "data-app-action-sidebar-project-id",
          "data-app-action-sidebar-project-path",
          "data-cwd",
          "title",
          "data-app-action-sidebar-project",
        ]
          .map((a) => node.getAttribute(a))
          .find((v) => v && /^(?:\/|[A-Za-z]:[\\/]|\\\\)/.test(v));
      const label =
        node.getAttribute("data-app-action-sidebar-project-label") ||
        node.getAttribute("data-project-label") ||
        node.getAttribute("aria-label") ||
        node.querySelector("[data-project-label]")?.textContent ||
        Array.from(node.childNodes)
          .map((n) => (n.nodeType === 3 ? n.textContent : ""))
          .join("")
          .trim() ||
        node.firstElementChild?.textContent?.trim();
      const byName = [...catalog.values()].filter(
        (p) => p.name === label || p.cwd === label,
      );
      const p = path
        ? catalog.get(workspaceKey(path)) || {
            cwd: path,
            name: label || path.split(/[\\/]/).pop() || path,
          }
        : byName.length === 1
          ? byName[0]
          : undefined;
      if (p) {
        candidates.set(node, p);
        catalog.set(workspaceKey(p.cwd), p);
      }
    }
    if (scroll) {
      scroll.querySelectorAll(projectSelector).forEach((el) => {
        if (!el.parentElement?.closest(projectSelector)) match(el);
      });
      for (const r of rows) {
        const cwd = r.threadId && threads.get(r.threadId);
        if (
          !r.isLocal ||
          !cwd ||
          !scroll.contains(r.element) ||
          [...candidates.keys()].some((e) => e.contains(r.element))
        )
          continue;
        const container = r.element.closest(
          "[data-app-action-sidebar-project-collapsed]",
        );
        if (container && scroll.contains(container)) {
          match(container, cwd);
          continue;
        }
        const listId = r.element
          .closest("[data-app-action-sidebar-project-list-id]")
          ?.getAttribute("data-app-action-sidebar-project-list-id");
        const header =
          (listId &&
            Array.from(
              scroll.querySelectorAll("[data-app-action-sidebar-project-row]"),
            ).find(
              (e) =>
                e.getAttribute("data-app-action-sidebar-project-id") === listId,
            )) ||
          r.element.closest('[role="listitem"]')?.parentElement
            ?.previousElementSibling;
        if (header && !header.querySelector(rowSelector)) match(header, cwd);
      }
      scroll
        .querySelectorAll(
          "button[aria-expanded],[data-app-action-sidebar-section] > header",
        )
        .forEach((e) => {
          if (
            !e.closest(projectSelector) &&
            ![...candidates.keys()].some((c) => c.contains(e))
          )
            match(e);
        });
    }
    known = [...catalog.values()];
    for (const [anchor, g] of groups)
      if (!groupsEnabled || !candidates.has(anchor) || !g.box.isConnected) {
        g.box.remove();
        groups.delete(anchor);
      }
    if (!groupsEnabled) return;
    const seen = new Set<string>();
    for (const [anchor, p] of candidates) {
      if (seen.has(p.cwd)) continue;
      seen.add(p.cwd);
      const topics = cards.filter(
          (c) => workspaceKey(c.projectCwd) === workspaceKey(p.cwd),
        ),
        isOpen = expanded.get(p.cwd) ?? saved(p.cwd);
      const signature = JSON.stringify([
        p.cwd,
        isOpen,
        title,
        topics.map((c) => [
          c.id,
          c.title,
          c.progress_pct,
          c.activeRunCount,
          c.status,
        ]),
      ]);
      let g = groups.get(anchor);
      if (g?.signature === signature) continue;
      if (!g) {
        const box = element("div", "group");
        api.dom.mount(
          box,
          anchor,
          !anchor.querySelector(rowSelector) &&
            anchor.matches(
              'button,[role="button"],header,[data-app-action-sidebar-project-collapsed]',
            )
            ? "after"
            : "append",
        );
        g = { box, signature: "" };
        groups.set(anchor, g);
      }
      g.signature = signature;
      const header = element("button", "group-header");
      header.setAttribute("aria-expanded", String(isOpen));
      header.append(
        icon(),
        title + " · " + topics.length + " " + (isOpen ? "⌄" : "›"),
      );
      header.onclick = () => {
        expanded.set(p.cwd, !isOpen);
        try {
          localStorage.setItem(
            "the-althing.project." + p.cwd,
            isOpen ? "closed" : "open",
          );
        } catch {}
        schedule();
      };
      g.box.replaceChildren(header);
      if (isOpen) {
        for (const c of topics) {
          const b = element("button", "topic");
          b.textContent =
            (activeCouncil(c) ? "● " : "") +
            c.title +
            " · " +
            c.progress_pct +
            "%";
          b.onclick = () => open({ topicId: c.id, projectCwd: p.cwd });
          g.box.append(b);
        }
        const create = element("button", "new");
        create.textContent = "+ " + translate("New Council", "新建议题");
        create.onclick = () => open({ newCouncil: true, projectCwd: p.cwd });
        g.box.append(create);
      }
    }
  }
  function schedule() {
    if (!ctrl.signal.aborted && !frame) frame = requestAnimationFrame(update);
  }
  const mutations = new MutationObserver((changes) => {
    if (
      changes.some((c) => {
        const target = c.target as Element;
        if (target.closest?.(owned)) return false;
        const changed = [...c.addedNodes, ...c.removedNodes];
        if (target.closest?.(sidebar + "," + rail))
          return (
            c.type === "attributes" ||
            changed.some((n) => !(n instanceof Element && n.matches(owned)))
          );
        return changed.some(
          (n) =>
            n instanceof Element &&
            (n.matches(sidebar + "," + rail) ||
              n.querySelector(sidebar + "," + rail)),
        );
      })
    )
      schedule();
  });
  mutations.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: [
      "data-project-cwd",
      "data-app-action-sidebar-project-id",
      "data-app-action-sidebar-project-label",
      "data-app-action-sidebar-project-collapsed",
      "data-app-action-sidebar-section-collapsed",
    ],
  });
  const offRows = api.sidebar.observeRows((r) => {
    rows = r;
    schedule();
  });
  const offAppearance = listenAppearance(api, document, (loc) => {
    english = !loc.startsWith("zh");
    schedule();
  });
  let settingsChanged = false;
  const settings = (s: Record<string, unknown>) => {
    groupsEnabled = s.showProjectAlthingItems !== false;
    schedule();
  };
  const offSettings = api.storage.onChange((s) => {
    settingsChanged = true;
    settings(s);
  });
  void api.storage
    .get()
    .then((s) => {
      if (!settingsChanged) settings(s);
    })
    .catch(() => {});
  let revision = 0;
  function sync() {
    const request = ++revision;
    void rpc
      .call<Card[]>("topics/list")
      .then((c) => {
        if (request === revision) {
          cards = c;
          schedule();
        }
      })
      .catch(() => {});
  }
  void rpc
    .call<{ projects: Project[] }>("codexhost/projects")
    .then((r) => {
      projects = r.projects;
      schedule();
    })
    .catch(() => {});
  void rpc
    .call<{ threads: { id?: string; threadId?: string; cwd?: string }[] }>(
      "codexhost/threads",
      { limit: 100 },
    )
    .then((r) => {
      for (const t of r.threads)
        if (t.cwd) threads.set(t.threadId || t.id || "", t.cwd);
      schedule();
    })
    .catch(() => {});
  function native(event: Event) {
    if (!overlay) return;
    const path = event
      .composedPath()
      .filter((el): el is Element => el instanceof Element);
    if (path.some((el) => el.matches(owned))) return;
    if (
      path.some(
        (el) =>
          el.matches(
            rowSelector +
              ",[data-sidebar-destination],[data-app-action-new-thread],[data-app-action-sidebar-new-thread],[data-app-action-sidebar-project-create],[data-codexhost-settings-trigger],[data-codexhost-settings-shell]",
          ) ||
          rows.some((r) => r.element === el) ||
          (el.matches("button,a,[role=button]") &&
            /^(?:new (?:thread|chat)|新建(?:对话|会话)|新话题)$/i.test(
              (
                el.getAttribute("aria-label") ||
                el.getAttribute("title") ||
                el.textContent ||
                ""
              ).trim(),
            )),
      )
    )
      close();
  }
  window.addEventListener("resize", place);
  document.addEventListener("click", native, true);
  sync();
  watchEvents(rpc, document, ctrl.signal, sync);
  schedule();
  function dispose() {
    if (ctrl.signal.aborted) return;
    ctrl.abort();
    close();
    cancelAnimationFrame(frame);
    mutations.disconnect();
    offRows();
    offSettings();
    offAppearance();
    top.remove();
    for (const { box } of groups.values()) box.remove();
    groups.clear();
    document.removeEventListener("click", native, true);
    window.removeEventListener("resize", place);
    api.signal.removeEventListener("abort", dispose);
  }
  api.track(dispose);
  api.signal.addEventListener("abort", dispose, { once: true });
  return dispose;
}
define({ activate });
