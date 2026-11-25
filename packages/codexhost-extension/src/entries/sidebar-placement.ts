import { workspaceKey, type Project } from "../frontend/host";

export type SidebarRowLike = {
  element: HTMLElement;
  threadId: string | null;
  isLocal: boolean;
};

export type TopPlacement = {
  anchor: Element;
  position: "prepend" | "before" | "after";
  styleSource: HTMLElement | null;
};

export const SIDEBAR_SCROLL_SELECTOR = "[data-app-action-sidebar-scroll]";
export const NAV_RAIL_SELECTOR = "nav[data-app-navigation-rail]";
export const PROJECT_SELECTOR =
  "[data-app-action-sidebar-project-row],[data-project-cwd],[data-project-path],[data-app-action-sidebar-project],[data-app-action-sidebar-project-collapsed],[data-app-action-sidebar-project-id]";
export const ROW_SELECTOR =
  "[data-app-action-sidebar-thread-row],[data-app-action-sidebar-thread-id]";

const PINNED_LABEL = /^(?:pinned|置顶|置頂|ピン留め|고정됨)$/i;
const BOT_NAV_LABEL =
  /^(?:bot|bots|automations?|scheduled(?:\s+tasks?)?|自动化|自動化|定时任务|定時任務|机器人|機器人|オートメーション|자동화)$/i;
const NEW_CHAT_LABEL =
  /^(?:new\s+(?:thread|chat)|新聊天|新建(?:对话|会话|聊天)|新话题|新しい(?:チャット|スレッド)|새\s*(?:채팅|스레드))$/i;
const SKILLS_NAV_LABEL = /^(?:skills?|技能|スキル|스킬)$/i;
const SPECIAL_SECTION_LABEL =
  /^(?:pinned|置顶|置頂|ピン留め|고정됨|threads?|线程|線程|对话|對話|chats?|聊天|recent|最近|archived|已归档|已封存|projects?|项目|專案|bot|bots|automations?|scheduled(?:\s+tasks?)?|自动化|自動化|定时任务|定時任務|机器人|機器人|skills?|技能|new\s+(?:thread|chat)|新聊天|新建(?:对话|会话|聊天)|新话题)$/i;

const NAV_ITEM_SELECTOR =
  'a,button,[role="button"],[data-sidebar-cycle-item],[data-app-action-new-thread],[data-app-action-sidebar-new-thread]';

export function normalizeThreadId(raw: unknown): string {
  if (typeof raw !== "string") return "";
  let id = raw.trim();
  if (!id) return "";
  if (id.startsWith("codex://threads/")) {
    id = id.slice("codex://threads/".length);
    try {
      id = decodeURIComponent(id);
    } catch {
      // Keep raw suffix if not percent-encoded.
    }
  }
  const colon = id.indexOf(":");
  if (colon > 0 && !id.startsWith("client-new-thread:")) {
    id = id.slice(colon + 1);
  }
  return id.trim();
}

export function isPinnedLabel(label: string): boolean {
  return PINNED_LABEL.test(label.trim());
}

export function isSpecialSectionLabel(label: string): boolean {
  const clean = label.trim();
  return !clean || SPECIAL_SECTION_LABEL.test(clean);
}

/**
 * Extract readable label text from a sidebar nav item or project header,
 * skipping leading `<svg>` icons, nested action buttons, and extension DOM.
 */
export function extractCleanLabel(
  node: Element,
  ownedSelector: string,
  foreignSelector: string,
): string {
  const explicit =
    node.getAttribute("data-app-action-sidebar-project-label") ||
    node.getAttribute("data-project-label") ||
    node.querySelector("[data-project-label]")?.textContent?.trim();
  if (explicit) return explicit.trim();

  const parts: string[] = [];
  const skipSelector = [ownedSelector, foreignSelector].filter(Boolean).join(",");
  const visit = (el: Node, depth: number) => {
    if (depth > 6) return;
    if (el.nodeType === 3) {
      const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
      if (text) parts.push(text);
      return;
    }
    if (!(el instanceof Element)) return;
    const tag = el.tagName.toLowerCase();
    if (tag === "svg" || tag === "style" || tag === "script" || tag === "kbd")
      return;
    if (el.getAttribute("aria-hidden") === "true") return;
    if (el !== node) {
      if (skipSelector && el.matches(skipSelector)) return;
      // Skip nested action buttons inside an existing button/row, or icon-only action controls.
      if (tag === "button" || el.getAttribute("role") === "button") {
        const nodeIsControl =
          node.tagName.toLowerCase() === "button" ||
          node.getAttribute("role") === "button";
        const rawControlText = (el.textContent ?? "")
          .replace(/[+\-×…·•\s]/g, "")
          .trim();
        if (nodeIsControl || !rawControlText) return;
      }
    }
    for (const child of el.childNodes) visit(child, depth + 1);
  };
  visit(node, 0);

  const filtered = parts.filter((p) => !/^\d+$/.test(p));
  const joined = (filtered.length ? filtered : parts).join(" ").trim();
  if (joined) return joined;

  return (
    node.getAttribute("aria-label") ||
    node.getAttribute("title") ||
    ""
  ).trim();
}

function isBefore(a: Element, b: Element): boolean {
  return Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
}

function isScheduledOrThreadRow(el: Element): boolean {
  if (el.matches(ROW_SELECTOR) || el.closest(ROW_SELECTOR)) return true;
  if (
    el.hasAttribute("aria-labelledby") &&
    el.querySelector("[data-thread-title]")
  )
    return true;
  return false;
}

function isBotNavItem(
  el: Element,
  ownedSelector: string,
  foreignSelector: string,
): boolean {
  if (isScheduledOrThreadRow(el)) return false;
  const href = el.getAttribute("href") || "";
  const dest = el.getAttribute("data-sidebar-destination") || "";
  if (
    /\/(?:automations|scheduled|bots?)(?:$|[/?#])/i.test(href) ||
    /(?:automation|scheduled|bot)/i.test(dest)
  )
    return true;
  const label = extractCleanLabel(el, ownedSelector, foreignSelector);
  return BOT_NAV_LABEL.test(label);
}

function isNewChatNavItem(
  el: Element,
  ownedSelector: string,
  foreignSelector: string,
): boolean {
  if (isScheduledOrThreadRow(el)) return false;
  if (
    el.matches(
      "[data-app-action-new-thread],[data-app-action-sidebar-new-thread]",
    )
  )
    return true;
  const label = extractCleanLabel(el, ownedSelector, foreignSelector);
  return NEW_CHAT_LABEL.test(label);
}

/**
 * Find the "Pinned / 置顶" boundary element inside the sidebar so the top
 * entry stays strictly above Pinned and project matching skips Pinned rows.
 */
function findPinnedHeader(
  root: Element,
  ownedSelector: string,
  foreignSelector: string,
): Element | null {
  const skip = [ownedSelector, foreignSelector].filter(Boolean).join(",");
  const candidates = root.querySelectorAll(
    'header,h1,h2,h3,h4,h5,h6,button,[role="button"],[data-app-action-sidebar-section] > div,span,div',
  );
  for (const el of candidates) {
    if (skip && el.closest(skip)) continue;
    if (el.closest(ROW_SELECTOR) || el.querySelector(ROW_SELECTOR)) continue;
    if (el.children.length > 4) continue;
    const text = extractCleanLabel(el, ownedSelector, foreignSelector);
    if (PINNED_LABEL.test(text)) return el;
  }
  return null;
}

function topNavRowContainer(
  item: HTMLElement,
  boundary: Element,
  peer?: Element | null,
): Element {
  let cursor: HTMLElement = item;
  for (let depth = 0; depth < 3; depth++) {
    const parent = cursor.parentElement;
    if (!parent || parent === boundary || parent.matches(SIDEBAR_SCROLL_SELECTOR))
      break;
    // Do not climb into a container that holds both New chat and Bot together.
    if (peer && parent.contains(peer)) break;
    const tag = parent.tagName.toLowerCase();
    const role = parent.getAttribute("role");
    const isListItem = tag === "li" || role === "listitem";
    const singleChild = parent.childElementCount === 1;
    const view = parent.ownerDocument.defaultView;
    const style = view?.getComputedStyle?.(parent);
    const isHorizontalBar =
      Boolean(style?.display?.includes("flex")) &&
      !style?.flexDirection?.startsWith("column") &&
      parent.querySelectorAll(NAV_ITEM_SELECTOR).length <= 2;
    if (isListItem || singleChild || isHorizontalBar) {
      cursor = parent;
      continue;
    }
    break;
  }
  return cursor;
}

/**
 * Resolve where to mount the top-level "The Althing / 议事厅" entry:
 * 1. Immediately after "Bot" (Automations) when above "Pinned / 置顶"
 * 2. Otherwise immediately after "New chat / 新聊天" when above "Pinned / 置顶"
 * 3. Otherwise immediately before the "Pinned / 置顶" section
 * 4. Otherwise prepend to `[data-app-action-sidebar-scroll]` / `nav[data-app-navigation-rail]`
 */
export function findTopPlacement(
  doc: Document,
  ownedSelector: string,
  foreignSelector: string,
): TopPlacement | null {
  const scroll = doc.querySelector<HTMLElement>(SIDEBAR_SCROLL_SELECTOR);
  const aside = scroll?.closest<HTMLElement>("aside") || null;
  const rail = doc.querySelector<HTMLElement>(NAV_RAIL_SELECTOR);
  const sidebarRoot = aside || scroll;
  if (!sidebarRoot) {
    return rail ? { anchor: rail, position: "prepend", styleSource: null } : null;
  }

  const skip = [ownedSelector, foreignSelector].filter(Boolean).join(",");
  const pinnedHeader = findPinnedHeader(sidebarRoot, ownedSelector, foreignSelector);

  let newChatItem: HTMLElement | null = null;
  let botItem: HTMLElement | null = null;
  let firstNavItem: HTMLElement | null = null;

  for (const el of sidebarRoot.querySelectorAll<HTMLElement>(NAV_ITEM_SELECTOR)) {
    if (skip && el.closest(skip)) continue;
    if (isScheduledOrThreadRow(el)) continue;
    // Ignore nav items located at or below the Pinned section.
    if (pinnedHeader && !isBefore(el, pinnedHeader)) continue;
    if (!firstNavItem) firstNavItem = el;
    if (!newChatItem && isNewChatNavItem(el, ownedSelector, foreignSelector)) {
      newChatItem = el;
    }
    if (!botItem && isBotNavItem(el, ownedSelector, foreignSelector)) {
      botItem = el;
    }
  }

  if (botItem) {
    const anchor = topNavRowContainer(botItem, sidebarRoot, newChatItem);
    return { anchor, position: "after", styleSource: botItem };
  }

  if (newChatItem) {
    const anchor = topNavRowContainer(newChatItem, sidebarRoot, null);
    return { anchor, position: "after", styleSource: newChatItem };
  }

  if (pinnedHeader) {
    let boundary: Element = pinnedHeader;
    const section = pinnedHeader.closest("[data-app-action-sidebar-section],section");
    if (section && sidebarRoot.contains(section) && section !== sidebarRoot) {
      boundary = section;
    } else {
      while (
        boundary.parentElement &&
        boundary.parentElement !== scroll &&
        boundary.parentElement !== sidebarRoot &&
        !boundary.parentElement.querySelector(ROW_SELECTOR)
      ) {
        boundary = boundary.parentElement;
      }
    }
    return { anchor: boundary, position: "before", styleSource: firstNavItem };
  }

  return {
    anchor: scroll || sidebarRoot,
    position: "prepend",
    styleSource: null,
  };
}

export function isInsidePinnedSection(
  element: Element,
  scroll: Element,
  ownedSelector: string,
  foreignSelector: string,
): boolean {
  let cursor: Element | null = element;
  while (cursor && cursor !== scroll) {
    const prev = cursor.previousElementSibling;
    if (prev && !prev.querySelector(ROW_SELECTOR)) {
      const label = extractCleanLabel(prev, ownedSelector, foreignSelector);
      if (PINNED_LABEL.test(label)) return true;
    }
    const header: Element | null = cursor.querySelector<Element>(
      ":scope > header, :scope > [data-sidebar-section-header], :scope > h2, :scope > h3, :scope > div:first-child",
    );
    if (header && header !== cursor && !header.contains(element) && !header.querySelector(ROW_SELECTOR)) {
      const label = extractCleanLabel(header, ownedSelector, foreignSelector);
      if (PINNED_LABEL.test(label)) return true;
    }
    cursor = cursor.parentElement;
  }
  return false;
}

function basenameOf(cwd: string): string {
  const clean = cwd.trim().replace(/[\\/]+$/, "");
  const parts = clean.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) || clean;
}

function sameLabel(a: string, b: string): boolean {
  const left = a.trim();
  const right = b.trim();
  if (!left || !right) return false;
  return left === right || left.toLowerCase() === right.toLowerCase();
}

export function findProjectAnchors(
  scroll: Element,
  rows: readonly SidebarRowLike[],
  threads: ReadonlyMap<string, string>,
  catalog: Map<string, Project>,
  ownedSelector: string,
  foreignSelector: string,
): Map<Element, Project> {
  const candidates = new Map<Element, Project>();
  const skip = [ownedSelector, foreignSelector].filter(Boolean).join(",");

  function match(node: Element, cwd?: string, allowLabelMatch = true) {
    if (
      candidates.has(node) ||
      (skip && node.closest(skip)) ||
      isScheduledOrThreadRow(node)
    )
      return;
    const explicitPath =
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

    const label = extractCleanLabel(node, ownedSelector, foreignSelector);
    if (!explicitPath && (!allowLabelMatch || isSpecialSectionLabel(label)))
      return;
    if (explicitPath && label && PINNED_LABEL.test(label)) return;

    const byName = !explicitPath
      ? [...catalog.values()].filter(
          (p) =>
            sameLabel(p.name, label) ||
            sameLabel(p.cwd, label) ||
            sameLabel(basenameOf(p.cwd), label),
        )
      : [];

    const p = explicitPath
      ? catalog.get(workspaceKey(explicitPath)) || {
          cwd: explicitPath,
          name: label || basenameOf(explicitPath),
        }
      : byName.length === 1
        ? byName[0]
        : undefined;

    if (p) {
      candidates.set(node, p);
      catalog.set(workspaceKey(p.cwd), p);
    }
  }

  // Pass 1: Explicit project attributes (legacy/custom builds & tests).
  scroll.querySelectorAll(PROJECT_SELECTOR).forEach((el) => {
    if (!el.parentElement?.closest(PROJECT_SELECTOR)) match(el);
  });

  // Pass 2: Infer project header from observed local thread rows outside Pinned.
  for (const r of rows) {
    const tid = normalizeThreadId(r.threadId);
    const cwd = tid ? threads.get(tid) : undefined;
    if (
      !r.isLocal ||
      !cwd ||
      !scroll.contains(r.element) ||
      isInsidePinnedSection(r.element, scroll, ownedSelector, foreignSelector) ||
      [...candidates.keys()].some((e) => e.contains(r.element))
    )
      continue;

    const collapsedContainer = r.element.closest(
      "[data-app-action-sidebar-project-collapsed]",
    );
    if (collapsedContainer && scroll.contains(collapsedContainer)) {
      match(collapsedContainer, cwd);
      continue;
    }

    const listId = r.element
      .closest("[data-app-action-sidebar-project-list-id]")
      ?.getAttribute("data-app-action-sidebar-project-list-id");
    if (listId) {
      const header = Array.from(
        scroll.querySelectorAll("[data-app-action-sidebar-project-row]"),
      ).find(
        (e) => e.getAttribute("data-app-action-sidebar-project-id") === listId,
      );
      if (header && !header.querySelector(ROW_SELECTOR)) {
        match(header, cwd);
        continue;
      }
    }

    // Walk up from the row's list container to find its preceding project header.
    let listContainer: Element | null =
      r.element.closest('[role="list"]') ||
      r.element.closest('[role="listitem"]')?.parentElement ||
      r.element.parentElement;
    let foundHeader: Element | null = null;
    for (let depth = 0; listContainer && listContainer !== scroll && depth < 4; depth++) {
      const prev = listContainer.previousElementSibling;
      if (
        prev &&
        !prev.querySelector(ROW_SELECTOR) &&
        !(skip && prev.closest(skip))
      ) {
        const primary =
          prev.querySelector(
            '[data-sidebar-cycle-item],button[aria-expanded],[role="button"][aria-expanded]',
          ) || prev;
        const prevLabel = extractCleanLabel(primary, ownedSelector, foreignSelector);
        if (!isSpecialSectionLabel(prevLabel)) {
          foundHeader = primary;
          break;
        }
      }
      listContainer = listContainer.parentElement;
    }
    if (foundHeader) match(foundHeader, cwd);
  }

  // Pass 3: Match project headers by name (covers collapsed Codex Desktop 26.1120 projects too).
  scroll
    .querySelectorAll(
      'button[aria-expanded],[role="button"][aria-expanded],[data-sidebar-cycle-item],[data-app-action-sidebar-section] > header',
    )
    .forEach((el) => {
      if (
        el.closest(PROJECT_SELECTOR) ||
        isScheduledOrThreadRow(el) ||
        [...candidates.keys()].some((c) => c.contains(el) || el.contains(c))
      )
        return;
      match(el, undefined, true);
    });

  return candidates;
}

/**
 * Assign each council card to its exact matching sidebar project first; if no
 * exact project matches, fall back to the deepest ancestor sidebar project
 * (e.g. a council in `repo/packages` under sidebar project `repo`).
 */
export function assignTopicsToProjects<T extends { projectCwd: string }>(
  cards: readonly T[],
  matchedProjects: readonly Project[],
): Map<string, T[]> {
  const byKey = new Map<string, T[]>();
  const projectKeys = matchedProjects.map((p) => workspaceKey(p.cwd));
  const exactSet = new Set(projectKeys);

  for (const card of cards) {
    if (!card.projectCwd) continue;
    const cardKey = workspaceKey(card.projectCwd);
    let targetKey: string | undefined;
    if (exactSet.has(cardKey)) {
      targetKey = cardKey;
    } else {
      let bestLen = -1;
      for (const pKey of projectKeys) {
        const prefix = pKey.endsWith("/") ? pKey : pKey + "/";
        if (cardKey.startsWith(prefix) && pKey.length > bestLen) {
          bestLen = pKey.length;
          targetKey = pKey;
        }
      }
    }
    if (!targetKey) continue;
    const bucket = byKey.get(targetKey) ?? [];
    bucket.push(card);
    byKey.set(targetKey, bucket);
  }

  return byKey;
}

/**
 * Mount a project's Althing group on its own vertical line below the project
 * header (never sideways inside a horizontal flex header bar).
 */
export function mountTargetForProjectAnchor(
  anchor: Element,
  rowSelector = ROW_SELECTOR,
): { target: Element; position: "after" | "append" } {
  if (anchor.querySelector(rowSelector)) {
    return { target: anchor, position: "append" };
  }
  const parent = anchor.parentElement;
  if (parent && !parent.querySelector(rowSelector) && !parent.querySelector('[role="list"]')) {
    const view = parent.ownerDocument.defaultView;
    const style = view?.getComputedStyle?.(parent);
    if (
      style?.display?.includes("flex") &&
      !style.flexDirection.startsWith("column")
    ) {
      return { target: parent, position: "after" };
    }
  }
  if (
    anchor.matches(
      'button,[role="button"],header,[data-app-action-sidebar-project-collapsed],[data-sidebar-cycle-item]',
    )
  ) {
    return { target: anchor, position: "after" };
  }
  return { target: anchor, position: "append" };
}

export function isNativeSidebarNavigationClick(
  el: Element,
  rows: readonly SidebarRowLike[],
  ownedSelector: string,
  foreignSelector: string,
): boolean {
  if (
    el.matches(
      ROW_SELECTOR +
        ",[data-sidebar-destination],[data-app-action-new-thread],[data-app-action-sidebar-new-thread],[data-app-action-sidebar-project-create],[data-codexhost-settings-trigger],[data-codexhost-settings-shell]",
    ) ||
    rows.some((r) => r.element === el)
  )
    return true;
  if (
    el.matches('button,a,[role="button"],[data-sidebar-cycle-item]') &&
    !el.closest(ownedSelector)
  ) {
    const label = extractCleanLabel(el, ownedSelector, foreignSelector);
    if (
      NEW_CHAT_LABEL.test(label) ||
      BOT_NAV_LABEL.test(label) ||
      SKILLS_NAV_LABEL.test(label)
    )
      return true;
  }
  return false;
}
