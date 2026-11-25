import { resolveLocale, translate as localize } from "../shared/i18n";
import { installCouncilCommand } from "./composer-command";
import {
  assignTopicsToProjects,
  findProjectAnchors,
  findTopPlacement,
  isNativeSidebarNavigationClick,
  mountTargetForProjectAnchor,
  NAV_RAIL_SELECTOR,
  normalizeThreadId,
  ROW_SELECTOR,
  SIDEBAR_SCROLL_SELECTOR,
  type SidebarRowLike,
} from "./sidebar-placement";
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

type Desktop = HostApi & {
  dom: {
    mount: (
      el: Element,
      parent: Element,
      position?: "prepend" | "append" | "before" | "after",
    ) => void;
  };
  sidebar: {
    observeRows: (cb: (rows: readonly SidebarRowLike[]) => void) => () => void;
  };
  navigate: { openThread: (id: string) => Promise<void> };
  track: (fn: () => void) => void;
};
declare const define: (extension: {
  activate: (api: Desktop) => () => void;
}) => void;

const sidebar = SIDEBAR_SCROLL_SELECTOR,
  rail = NAV_RAIL_SELECTOR,
  owned = "[data-althing-owned]";
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
  svg.setAttribute("width", "16");
  svg.setAttribute("height", "16");
  svg.setAttribute("aria-hidden", "true");
  path.setAttribute(
    "d",
    "M2 8 12 3l10 5v2H2zm3 4h3v7H5zm6 0h2v7h-2zm5 0h3v7h-3zM2 21h20v2H2z",
  );
  path.setAttribute("fill", "currentColor");
  svg.append(path);
  return svg;
}

function isAlreadyMounted(
  node: Element,
  anchor: Element,
  position: "prepend" | "append" | "before" | "after",
): boolean {
  if (position === "after") return anchor.nextElementSibling === node;
  if (position === "before") return anchor.previousElementSibling === node;
  if (position === "prepend")
    return node.parentElement === anchor && anchor.firstElementChild === node;
  return node.parentElement === anchor;
}

function resolveTopVisibility(
  s: Record<string, unknown>,
): "always" | "active" | "hidden" {
  if (
    s.sidebarEntryVisibility === "always" ||
    s.sidebarEntryVisibility === "active" ||
    s.sidebarEntryVisibility === "hidden"
  ) {
    return s.sidebarEntryVisibility;
  }
  // Preserve explicit opt-out from earlier versions while adopting "always" as the new default.
  if (s.sidebarAlthingVisibility === "hidden") return "hidden";
  return "always";
}

function activate(api: Desktop) {
  const ctrl = new AbortController(),
    rpc = new RpcClient(api.backend, ctrl.signal);
  let topVisibility: "active" | "always" | "hidden" = "always",
    groupsEnabled = true,
    hostLocale = "en",
    preference: unknown = "auto",
    rows: readonly SidebarRowLike[] = [],
    cards: Card[] = [],
    projects: Project[] = [],
    threads = new Map<string, string>();
  const groups = new Map<
      Element,
      { box: HTMLElement; target: Element; position: "after" | "append"; signature: string }
    >(),
    expanded = new Map<string, boolean>();
  let overlay: HTMLElement | undefined,
    unmount: (() => void) | undefined,
    resize: ResizeObserver | undefined,
    frame = 0,
    measured: Element[] = [],
    known: Project[] = [],
    lastCatalogRefresh = 0;

  const top = element("button", "top");
  top.type = "button";
  const topText = document.createElement("span"),
    pill = document.createElement("small");
  top.append(icon(), topText, pill);

  const translate = (en: string, zh: string) =>
    localize(resolveLocale(hostLocale, preference), en, zh);

  function syncTopSelected() {
    if (overlay) top.setAttribute("aria-current", "page");
    else top.removeAttribute("aria-current");
  }

  function close() {
    resize?.disconnect();
    measured = [];
    resize = undefined;
    unmount?.();
    unmount = undefined;
    overlay?.remove();
    overlay = undefined;
    syncTopSelected();
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
    syncTopSelected();
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

  function refreshHostCatalog(force = false) {
    const now = Date.now();
    if (!force && now - lastCatalogRefresh < 4_000) return;
    lastCatalogRefresh = now;
    void rpc
      .call<{ projects: Project[] }>("codexhost/projects")
      .then((r) => {
        if (Array.isArray(r.projects)) {
          projects = r.projects;
          schedule();
        }
      })
      .catch(() => {});
    void rpc
      .call<{
        threads: { id?: string; threadId?: string; thread?: string; cwd?: string }[];
      }>("codexhost/threads", { limit: 100 })
      .then((r) => {
        let changed = false;
        for (const t of r.threads ?? []) {
          if (!t.cwd) continue;
          const rawId = t.threadId || t.id || t.thread || "";
          const norm = normalizeThreadId(rawId);
          if (norm && threads.get(norm) !== t.cwd) {
            threads.set(norm, t.cwd);
            changed = true;
          }
          if (rawId && threads.get(rawId) !== t.cwd) {
            threads.set(rawId, t.cwd);
          }
        }
        if (changed) schedule();
      })
      .catch(() => {});
  }

  function applySampledStyle(target: HTMLElement, source: Element | null) {
    if (!source) return;
    const style = window.getComputedStyle(source);
    if (style.fontSize && target.style.fontSize !== style.fontSize) {
      target.style.fontSize = style.fontSize;
    }
  }

  function update() {
    frame = 0;
    if (ctrl.signal.aborted) return;
    place();
    const scroll = document.querySelector(sidebar),
      placement = findTopPlacement(document, owned, foreign);
    if (!placement) {
      top.remove();
      for (const { box } of groups.values()) box.remove();
      groups.clear();
      return;
    }

    const title = translate("The Althing", "议事厅"),
      n = cards.filter(activeCouncil).length;
    const sampleParent = scroll || placement.anchor.parentElement || placement.anchor;
    const nativeLabel =
      sampleParent.querySelector("[data-thread-title]") ||
      sampleParent.querySelector(ROW_SELECTOR) ||
      placement.styleSource ||
      sampleParent.querySelector(
        "[data-app-action-sidebar-project-row],[data-sidebar-destination]",
      );
    const fontSize = nativeLabel
      ? window.getComputedStyle(nativeLabel).fontSize
      : "";

    if (topVisibility === "always" || (topVisibility === "active" && n > 0)) {
      applySampledStyle(top, placement.styleSource || nativeLabel);
      if (placement.styleSource) {
        const navStyle = window.getComputedStyle(placement.styleSource);
        if (
          navStyle.minHeight &&
          navStyle.minHeight !== "0px" &&
          top.style.minHeight !== navStyle.minHeight
        ) {
          top.style.minHeight = navStyle.minHeight;
        }
        if (
          navStyle.borderRadius &&
          navStyle.borderRadius !== "0px" &&
          top.style.borderRadius !== navStyle.borderRadius
        ) {
          top.style.borderRadius = navStyle.borderRadius;
        }
      }
      if (!isAlreadyMounted(top, placement.anchor, placement.position)) {
        api.dom.mount(top, placement.anchor, placement.position);
      }
    } else {
      top.remove();
    }

    if (topText.textContent !== title) topText.textContent = title;
    if (pill.hidden !== !n) pill.hidden = !n;
    const pillText = n ? String(n) : "";
    if (pill.textContent !== pillText) pill.textContent = pillText;
    pill.title = translate("Active councils", "活跃议题");
    syncTopSelected();

    const catalog = new Map<string, Project>();
    for (const c of cards)
      if (c.projectCwd)
        catalog.set(workspaceKey(c.projectCwd), {
          cwd: c.projectCwd,
          name: c.projectLabel || c.projectCwd.split(/[\\/]/).pop()!,
        });
    for (const p of projects) catalog.set(workspaceKey(p.cwd), p);

    const candidates = scroll
      ? findProjectAnchors(scroll, rows, threads, catalog, owned, foreign)
      : new Map<Element, Project>();

    known = [...catalog.values()];

    const matchedProjects: Project[] = [];
    const seenMatched = new Set<string>();
    for (const p of candidates.values()) {
      const k = workspaceKey(p.cwd);
      if (!seenMatched.has(k)) {
        seenMatched.add(k);
        matchedProjects.push(p);
      }
    }
    const topicsByProject = assignTopicsToProjects(cards, matchedProjects);

    const visible = new Set<Element>(),
      seen = new Set<string>();
    for (const [anchor, p] of candidates) {
      if (!groupsEnabled) break;
      const key = workspaceKey(p.cwd);
      if (seen.has(key)) continue;
      const topics = topicsByProject.get(key) ?? [];
      if (!topics.length) continue;
      seen.add(key);
      visible.add(anchor);
      const isOpen = expanded.get(p.cwd) ?? saved(p.cwd);
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
      const mountSpec = mountTargetForProjectAnchor(anchor, ROW_SELECTOR);
      let g = groups.get(anchor);
      if (
        !g?.box.isConnected ||
        g.target !== mountSpec.target ||
        g.position !== mountSpec.position ||
        !isAlreadyMounted(g.box, mountSpec.target, mountSpec.position)
      ) {
        const box = g?.box ?? element("div", "group");
        api.dom.mount(box, mountSpec.target, mountSpec.position);
        g = {
          box,
          target: mountSpec.target,
          position: mountSpec.position,
          signature: g?.signature ?? "",
        };
        groups.set(anchor, g);
      }
      if (fontSize && g.box.style.fontSize !== fontSize)
        g.box.style.fontSize = fontSize;
      if (g.signature === signature) continue;
      g.signature = signature;
      const header = element("button", "group-header");
      header.type = "button";
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
          b.type = "button";
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
        create.type = "button";
        create.textContent = "+ " + translate("New Council", "新建议题");
        create.onclick = () => open({ newCouncil: true, projectCwd: p.cwd });
        g.box.append(create);
      }
    }
    for (const [anchor, g] of groups) {
      if (!visible.has(anchor)) {
        g.box.remove();
        groups.delete(anchor);
      }
    }
  }

  function schedule() {
    if (!ctrl.signal.aborted && !frame) frame = requestAnimationFrame(update);
  }

  const sidebarRegion = "aside," + sidebar + "," + rail;
  const mutations = new MutationObserver((changes) => {
    if (
      changes.some((c) => {
        const target = c.target as Element;
        if (target.closest?.(owned)) return false;
        const changed = [...c.addedNodes, ...c.removedNodes];
        if (target.closest?.(sidebarRegion))
          return (
            c.type === "attributes" ||
            changed.some((n) => !(n instanceof Element && n.matches(owned)))
          );
        return changed.some(
          (n) =>
            n instanceof Element &&
            (n.matches(sidebarRegion) || n.querySelector(sidebarRegion)),
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
      "aria-expanded",
    ],
  });

  function activeProjectCwd() {
    // Codex Desktop marks the open conversation right above its composer.
    const aboveComposer = document
      .querySelector("[data-above-composer-conversation-id]")
      ?.getAttribute("data-above-composer-conversation-id");
    if (aboveComposer) {
      const cwd =
        threads.get(normalizeThreadId(aboveComposer)) ||
        threads.get(aboveComposer);
      if (cwd) return cwd;
    }

    const activeSelector =
      '[data-app-action-sidebar-thread-active],[data-app-action-sidebar-thread-selected],[aria-current],[aria-selected="true"],[data-active="true"],[data-selected="true"]';
    for (const r of rows) {
      if (!r.threadId) continue;
      if (
        r.element.matches(activeSelector) ||
        r.element.querySelector(activeSelector)
      ) {
        const cwd =
          threads.get(normalizeThreadId(r.threadId)) || threads.get(r.threadId);
        if (cwd) return cwd;
      }
    }
    const activeProject = document.querySelector(
      "[data-project-cwd][aria-current],[data-project-cwd][data-active='true'],[data-project-path][aria-current],[data-project-path][data-active='true']",
    );
    const attrCwd =
      activeProject?.getAttribute("data-project-cwd") ||
      activeProject?.getAttribute("data-project-path");
    if (attrCwd) return attrCwd;
    return known.length === 1 ? known[0].cwd : undefined;
  }

  const offCommand = installCouncilCommand(
    (cmd) => {
      const projectCwd = activeProjectCwd();
      if (cmd.prompt && !cmd.custom) {
        open({
          convenePrompt: cmd.prompt,
          conveneProtocol: cmd.protocol,
          conveneExpertCount: cmd.expertCount,
          projectCwd,
        });
      } else {
        open({
          newCouncil: true,
          commandTopic: cmd.prompt,
          conveneProtocol: cmd.protocol,
          conveneExpertCount: cmd.expertCount,
          customSetup: cmd.custom,
          projectCwd,
        });
      }
    },
    (instant) =>
      instant
        ? translate("Press Enter to convene council", "回车直接召开议会")
        : translate("Start a council", "发起会议"),
    {
      mount: (node) => api.dom.mount(node, document.body, "append"),
    },
  );

  const offRows = api.sidebar.observeRows((r) => {
    rows = r;
    const hasUnknown = r.some((row) => {
      const id = normalizeThreadId(row.threadId);
      return row.isLocal && id && !threads.has(id);
    });
    if (hasUnknown) refreshHostCatalog();
    schedule();
  });

  const offAppearance = listenAppearance(api, document, (loc) => {
    hostLocale = loc;
    offCommand.refreshLabel();
    schedule();
  });

  let settingsChanged = false;
  const settings = (s: Record<string, unknown>) => {
    preference = s.language;
    offCommand.refreshLabel();
    groupsEnabled = s.showProjectAlthingItems !== false;
    topVisibility = resolveTopVisibility(s);
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

  refreshHostCatalog(true);

  function native(event: Event) {
    if (!overlay) return;
    const path = event
      .composedPath()
      .filter((el): el is Element => el instanceof Element);
    if (path.some((el) => el.matches(owned))) return;
    if (
      path.some((el) =>
        isNativeSidebarNavigationClick(el, rows, owned, foreign),
      )
    )
      close();
  }

  window.addEventListener("resize", place);
  document.addEventListener("click", native, true);
  sync();
  watchEvents(rpc, document, ctrl.signal, () => {
    sync();
    refreshHostCatalog();
  });
  schedule();

  function dispose() {
    if (ctrl.signal.aborted) return;
    ctrl.abort();
    close();
    cancelAnimationFrame(frame);
    mutations.disconnect();
    offCommand();
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
