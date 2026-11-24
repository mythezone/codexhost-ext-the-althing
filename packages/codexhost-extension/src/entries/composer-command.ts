import {
  isCouncilCommandPrefix,
  parseCouncilCommand,
  type CouncilProtocolId,
} from "../shared/command";

// Desktop and Web expose their composer DOM, but no slash-command registry.
const composer = "[data-codex-composer-root],[data-composer-card]";
const editable = 'textarea,[contenteditable="true"]';
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

export function installCouncilCommand(
  launch: (command: CouncilLaunch) => void,
  label: (instant: boolean) => string,
) {
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.althingCommand = "";
  let source: HTMLElement | undefined;
  let composing = false,
    frame = 0;

  function editorOf(target: EventTarget | null) {
    if (!(target instanceof Element)) return;
    const editor = target.closest<HTMLElement>(editable);
    if (
      editor?.closest(composer) &&
      !editor.querySelector(
        '[contenteditable="false"],img,[data-composer-chip]',
      )
    )
      return editor;
  }
  function draft(editor: HTMLElement) {
    if (editor instanceof HTMLTextAreaElement) return editor.value.trim();
    // Most drafts are ordinary chat. Only read layout-dependent text for a possible command.
    const raw = editor.textContent ?? "";
    return raw.trimStart().startsWith("/")
      ? (editor.innerText ?? raw).trim()
      : "";
  }
  function hide() {
    button.remove();
    source = undefined;
  }
  function suggest(editor?: HTMLElement) {
    if (!editor || composing) return hide();
    const text = draft(editor);
    const parsed = parseCouncilCommand(text);
    const prefix = isCouncilCommandPrefix(text);
    if (!text || (!parsed && !prefix)) return hide();
    source = editor;
    const instant = Boolean(parsed && parsed.prompt && !parsed.custom);
    button.textContent = "/althing · " + label(instant);
    const host = editor.closest(composer)!;
    if (button.parentElement !== host) host.append(button);
  }
  function refresh(event: Event) {
    if (event.target !== button) suggest(editorOf(event.target));
  }
  function beforeInput(event: Event) {
    const editor = editorOf(event.target);
    if (!editor) return;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      if (document.activeElement === editor && editor.isConnected)
        suggest(editor);
    });
  }
  function replaceDraft(editor: HTMLElement, nextValue: string, expectedText: string) {
    // Apply a native editing operation so the host also updates its controlled draft.
    editor.focus({ preventScroll: true });
    if (editor instanceof HTMLTextAreaElement) {
      editor.setRangeText(nextValue, 0, editor.value.length, "end");
      editor.dispatchEvent(new Event("input", { bubbles: true }));
      return;
    }
    const selection = document.getSelection();
    if (!selection) return;
    const range = document.createRange();
    const nodes = document.createTreeWalker(editor, 4 /* SHOW_TEXT */);
    const first = nodes.nextNode();
    if (first) {
      let last = first;
      while (nodes.nextNode()) last = nodes.currentNode;
      range.setStart(first, 0);
      range.setEnd(last, last.textContent?.length ?? 0);
    } else range.selectNodeContents(editor);
    selection.removeAllRanges();
    selection.addRange(range);
    // Rich editors such as Lexical consume beforeinput using the DOM selection.
    document.dispatchEvent(new Event("selectionchange"));
    if (!nextValue) {
      const nativeDelete = editor.dispatchEvent(
        new InputEvent("beforeinput", {
          inputType: "deleteContentBackward",
          bubbles: true,
          cancelable: true,
        }),
      );
      if (
        nativeDelete &&
        draft(editor) === expectedText &&
        selection.toString().trim() === expectedText &&
        editor.contains(selection.anchorNode) &&
        editor.contains(selection.focusNode)
      )
        document.execCommand?.("delete");
      return;
    }
    const nativeInsert = editor.dispatchEvent(
      new InputEvent("beforeinput", {
        inputType: "insertText",
        data: nextValue,
        bubbles: true,
        cancelable: true,
      }),
    );
    if (nativeInsert && draft(editor) === expectedText) {
      if (!document.execCommand?.("insertText", false, nextValue)) {
        editor.textContent = nextValue;
        const end = document.createRange();
        end.selectNodeContents(editor);
        end.collapse(false);
        selection.removeAllRanges();
        selection.addRange(end);
        editor.dispatchEvent(new Event("input", { bubbles: true }));
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
    replaceDraft(editor, "", text);
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
    if (
      event.key === "Tab" &&
      !event.isComposing &&
      event.keyCode !== 229 &&
      !event.shiftKey &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey
    ) {
      const editor = editorOf(event.target);
      if (!editor || composing) return;
      const text = draft(editor);
      if (isCouncilCommandPrefix(text) && text.toLowerCase() !== "/althing") {
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
    )
      run(event, editorOf(event.target));
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
    const target = event.target;
    if (!(target instanceof Element)) return;
    const host =
      target.closest(composer) ??
      (event.type === "submit" ? target.querySelector(composer) : null);
    if (!host) return;
    if (event.type === "click") {
      const control = target.closest("button");
      if (!control || !isSendButton(control)) return;
    }
    run(event, editorOf(host.querySelector(editable)));
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
  };
  return Object.assign(dispose, {
    refreshLabel: () => {
      if (source) suggest(source);
    },
  });
}
