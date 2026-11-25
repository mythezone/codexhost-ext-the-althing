import {
  isCouncilCommandPrefix,
  parseCouncilCommand,
  type CouncilProtocolId,
} from "../shared/command";

// Desktop (ProseMirror) and Web (Lexical/textarea) expose their composer DOM,
// but CodexHost v0.26.x does not expose a public extension slash-command registry.
const composer = "[data-codex-composer-root],[data-composer-card]";
const editable =
  'textarea,.ProseMirror[contenteditable="true"],[contenteditable="true"][role="textbox"],[contenteditable="true"]';
const ownSurface =
  "[data-althing-owned],[data-althing-web-workspace],[data-cx-host-widget],[data-host-extension-page]";
const nonSendControl =
  /\b(?:cancel|stop|abort|attach|upload|file|image|photo|voice|mic|audio|record|clear|close|remove|delete|emoji|mention|slash|mode|model|thinking|settings)\b|取消|停止|附件|上传|上傳|图片|圖片|语音|語音|清除|关闭|關閉|删除|刪除|模型|设置|設定/i;
const sendControl =
  /\b(?:send|submit)\b|发送|發送|傳送|送信|보내기|提交/i;

export type CouncilLaunch = {
  prompt: string;
  custom: boolean;
  protocol?: CouncilProtocolId;
  expertCount?: number;
};

export type CouncilCommandOptions = {
  /** Mount callback so Desktop can track extension-owned DOM via api.dom.mount. */
  mount?: (node: HTMLElement) => void;
};

function targetElement(target: EventTarget | null): Element | null {
  if (target instanceof Element) return target;
  return target instanceof Node ? target.parentElement : null;
}

function cleanText(raw: string): string {
  return raw.replace(/\u200B/g, "").replace(/\u00A0/g, " ");
}

export function installCouncilCommand(
  launch: (command: CouncilLaunch) => void,
  label: (instant: boolean) => string,
  options: CouncilCommandOptions = {},
) {
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.althingCommand = "";
  let source: HTMLElement | undefined;
  let composing = false,
    frame = 0;

  function editorOf(target: EventTarget | null): HTMLElement | undefined {
    const el = targetElement(target);
    if (!el || el.closest(ownSurface)) return;
    const editor = el.closest<HTMLElement>(editable);
    if (!editor || editor.closest(ownSurface)) return;
    // Accept editors inside a known composer root OR Codex Desktop's ProseMirror editor.
    const inComposer =
      Boolean(editor.closest(composer)) || editor.classList.contains("ProseMirror");
    if (!inComposer) return;
    if (editor.querySelector("img")) return;
    return editor;
  }

  function composerHostOf(editor: HTMLElement): HTMLElement {
    return editor.closest<HTMLElement>(composer) ?? editor.parentElement ?? editor;
  }

  function draft(editor: HTMLElement) {
    if (editor instanceof HTMLTextAreaElement)
      return cleanText(editor.value).trim();
    // Most drafts are ordinary chat. Only read layout-dependent text for a possible command.
    const raw = cleanText(editor.textContent ?? "");
    const lead = raw.trimStart();
    if (!lead.startsWith("/") && !lead.startsWith("／")) return "";
    return cleanText(editor.innerText || raw).trim();
  }

  function position() {
    if (!source || !button.isConnected) return;
    const host = composerHostOf(source);
    const rect = host.getBoundingClientRect();
    if (rect.width <= 0 && rect.height <= 0) return;
    const vw = window.innerWidth || 1024;
    const vh = window.innerHeight || 768;
    const width = button.getBoundingClientRect().width || 220;
    const height = button.getBoundingClientRect().height || 32;
    const left = Math.max(8, Math.min(rect.left, vw - width - 8));
    const above = rect.top >= height + 10;
    const top = above
      ? rect.top - height - 6
      : Math.min(vh - height - 8, rect.bottom + 6);
    button.style.left = `${Math.round(left)}px`;
    button.style.top = `${Math.max(8, Math.round(top))}px`;
  }

  function hide() {
    button.remove();
    source = undefined;
  }

  function suggest(editor?: HTMLElement) {
    if (!editor || !editor.isConnected || composing) return hide();
    const text = draft(editor);
    const parsed = parseCouncilCommand(text);
    const prefix = isCouncilCommandPrefix(text);
    if (!text || (!parsed && !prefix)) return hide();
    source = editor;
    const instant = Boolean(parsed && parsed.prompt && !parsed.custom);
    button.textContent = "/althing · " + label(instant);
    // Mount outside [data-codex-composer-root] so we never trigger CodexHost's
    // composer MutationObserver or get clipped by overflow:hidden cards.
    if (!button.isConnected) {
      if (options.mount) options.mount(button);
      else document.body.append(button);
    }
    position();
  }

  function refresh(event: Event) {
    if (event.target !== button)
      suggest(editorOf(event.target) ?? editorOf(document.activeElement));
  }

  function beforeInput(event: Event) {
    const editor = editorOf(event.target);
    if (!editor) return;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      if (
        editor.isConnected &&
        (document.activeElement === editor ||
          (document.activeElement instanceof Node &&
            editor.contains(document.activeElement)))
      )
        suggest(editor);
    });
  }

  function selectAllContent(editor: HTMLElement) {
    const selection = document.getSelection();
    if (!selection) return null;
    const range = document.createRange();
    const nodes = document.createTreeWalker(editor, 4 /* SHOW_TEXT */);
    const first = nodes.nextNode();
    if (first) {
      let last = first;
      while (nodes.nextNode()) last = nodes.currentNode;
      range.setStart(first, 0);
      range.setEnd(last, last.textContent?.length ?? 0);
    } else {
      range.selectNodeContents(editor);
    }
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
    return selection;
  }

  function replaceDraft(
    editor: HTMLElement,
    nextValue: string,
    expectedText: string,
  ) {
    editor.focus({ preventScroll: true });
    if (editor instanceof HTMLTextAreaElement) {
      const proto = editor.ownerDocument.defaultView?.HTMLTextAreaElement.prototype;
      const setter = proto
        ? Object.getOwnPropertyDescriptor(proto, "value")?.set
        : undefined;
      if (setter) {
        setter.call(editor, nextValue);
        try {
          editor.setSelectionRange(nextValue.length, nextValue.length);
        } catch {
          // Ignore selection errors in detached/non-interactive inputs.
        }
      } else {
        editor.setRangeText(nextValue, 0, editor.value.length, "end");
      }
      editor.dispatchEvent(
        new Event("input", { bubbles: true, composed: true }),
      );
      return;
    }

    const selection = selectAllContent(editor);
    if (!selection) return;
    const win = editor.ownerDocument.defaultView;
    const makeInputEvent = (
      type: string,
      init: {
        inputType: string;
        data?: string | null;
        bubbles?: boolean;
        cancelable?: boolean;
        composed?: boolean;
      },
    ) => {
      const Ctor =
        win?.InputEvent ?? (typeof InputEvent !== "undefined" ? InputEvent : null);
      return Ctor
        ? new Ctor(type, init)
        : new Event(type, {
            bubbles: init.bubbles,
            cancelable: init.cancelable,
            composed: init.composed,
          });
    };

    if (!nextValue) {
      // 1. Lexical handles synthetic beforeinput using the active DOM selection.
      const nativeDelete = editor.dispatchEvent(
        makeInputEvent("beforeinput", {
          inputType: "deleteContentBackward",
          bubbles: true,
          cancelable: true,
        }),
      );
      if (draft(editor) === "") return;

      // 2. ProseMirror (Codex Desktop Electron/Chromium) updates EditorState cleanly
      // via native selectAll + delete commands.
      if (nativeDelete || draft(editor) === expectedText) {
        try {
          selectAllContent(editor);
          if (document.activeElement === editor) {
            document.execCommand?.("selectAll");
          }
          document.execCommand?.("delete");
        } catch {
          // Fall through to direct DOM cleanup.
        }
      }

      if (draft(editor) !== "") {
        editor.textContent = "";
        editor.dispatchEvent(
          makeInputEvent("input", {
            bubbles: true,
            composed: true,
            inputType: "deleteContentBackward",
          }),
        );
      }
      return;
    }

    // Replacing text (e.g. Tab autocomplete "/alt" -> "/althing "):
    const nativeInsert = editor.dispatchEvent(
      makeInputEvent("beforeinput", {
        inputType: "insertText",
        data: nextValue,
        bubbles: true,
        cancelable: true,
      }),
    );
    if (draft(editor) === nextValue.trim()) return;

    if (nativeInsert || draft(editor) === expectedText) {
      selectAllContent(editor);
      // ProseMirror handles ClipboardEvent("paste") cleanly through its own transaction.
      if (
        win &&
        typeof win.DataTransfer === "function" &&
        typeof win.ClipboardEvent === "function"
      ) {
        try {
          const dt = new win.DataTransfer();
          dt.setData("text/plain", nextValue);
          const paste = new win.ClipboardEvent("paste", {
            bubbles: true,
            composed: true,
            cancelable: true,
            clipboardData: dt,
          });
          editor.dispatchEvent(paste);
        } catch {
          // Fall through to execCommand.
        }
      }
      if (draft(editor) !== nextValue.trim()) {
        try {
          selectAllContent(editor);
          document.execCommand?.("insertText", false, nextValue);
        } catch {
          // Fall through to textContent fallback.
        }
      }
      if (draft(editor) !== nextValue.trim()) {
        editor.textContent = nextValue;
        const end = document.createRange();
        end.selectNodeContents(editor);
        end.collapse(false);
        selection.removeAllRanges();
        selection.addRange(end);
        editor.dispatchEvent(
          makeInputEvent("input", {
            bubbles: true,
            composed: true,
            inputType: "insertText",
            data: nextValue,
          }),
        );
      }
    }
  }

  function run(event: Event, editor?: HTMLElement, allowPrefix = false) {
    if (!editor || !editor.isConnected || composing) return;
    const text = draft(editor);
    const parsed = parseCouncilCommand(text);
    if (!parsed && !(allowPrefix && isCouncilCommandPrefix(text))) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    try {
      replaceDraft(editor, "", text);
    } catch {
      // Never let a host editor quirk block opening the council.
    }
    hide();
    launch({
      prompt: parsed?.prompt ?? "",
      custom: parsed?.custom ?? false,
      ...(parsed?.protocol ? { protocol: parsed.protocol } : {}),
      ...(parsed?.expertCount ? { expertCount: parsed.expertCount } : {}),
    });
  }

  function key(event: KeyboardEvent) {
    if (event.key === "Escape") {
      hide();
      return;
    }
    const editor = editorOf(event.target) ?? editorOf(document.activeElement);
    if (!editor || composing) return;

    if (
      event.key === "Tab" &&
      !event.isComposing &&
      event.keyCode !== 229 &&
      !event.shiftKey &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey
    ) {
      const text = draft(editor);
      const normalized = text.replace(/^／/, "/").toLowerCase();
      if (isCouncilCommandPrefix(text) && normalized !== "/althing") {
        event.preventDefault();
        event.stopImmediatePropagation();
        replaceDraft(editor, "/althing ", text);
        suggest(editor);
      }
      return;
    }

    if (
      event.key === "Enter" &&
      !event.isComposing &&
      event.keyCode !== 229 &&
      !event.shiftKey &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey
    ) {
      run(event, editor);
    }
  }

  function isSendButton(control: HTMLButtonElement) {
    if (control === button) return false;
    if (control.matches('[type="submit"]')) return true;
    const labels = [
      control.getAttribute("aria-label") || "",
      control.title || "",
      control.dataset.testid || "",
    ].join(" ");
    if (!labels.trim() || nonSendControl.test(labels)) return false;
    return sendControl.test(labels);
  }

  function send(event: Event) {
    const target = targetElement(event.target);
    if (!target || target.closest(ownSurface)) return;
    const host =
      target.closest(composer) ??
      (event.type === "submit" ? target.querySelector(composer) : null);
    if (!host) return;
    if (event.type === "click") {
      const control = target.closest("button");
      if (!control || !isSendButton(control)) return;
    }
    const editor =
      editorOf(host.querySelector(editable)) ??
      (source && host.contains(source) ? source : undefined);
    run(event, editor);
  }

  const begin = (e: CompositionEvent) => {
    if (editorOf(e.target)) {
      composing = true;
      hide();
    }
  };
  const end = (e: CompositionEvent) => {
    composing = false;
    refresh(e);
  };
  const blur = (e: FocusEvent) => {
    if (
      e.relatedTarget &&
      e.relatedTarget !== button &&
      (e.target === source || e.target === button)
    ) {
      composing = false;
      hide();
    }
  };
  const reposition = () => position();

  // Keep editor focus and selection intact while clicking the command pill.
  button.addEventListener("mousedown", (e) => e.preventDefault());
  button.onclick = (e) => run(e, source, true);

  window.addEventListener("beforeinput", beforeInput, true);
  window.addEventListener("input", refresh, true);
  window.addEventListener("focusin", refresh, true);
  window.addEventListener("focusout", blur, true);
  window.addEventListener("compositionstart", begin, true);
  window.addEventListener("compositionend", end, true);
  window.addEventListener("keydown", key, true);
  window.addEventListener("click", send, true);
  window.addEventListener("submit", send, true);
  window.addEventListener("resize", reposition, { passive: true });
  window.addEventListener("scroll", reposition, { capture: true, passive: true });

  const dispose = () => {
    hide();
    cancelAnimationFrame(frame);
    window.removeEventListener("beforeinput", beforeInput, true);
    window.removeEventListener("input", refresh, true);
    window.removeEventListener("focusin", refresh, true);
    window.removeEventListener("focusout", blur, true);
    window.removeEventListener("compositionstart", begin, true);
    window.removeEventListener("compositionend", end, true);
    window.removeEventListener("keydown", key, true);
    window.removeEventListener("click", send, true);
    window.removeEventListener("submit", send, true);
    window.removeEventListener("resize", reposition);
    window.removeEventListener("scroll", reposition, true);
  };
  return Object.assign(dispose, {
    refreshLabel: () => {
      if (source) suggest(source);
    },
  });
}
