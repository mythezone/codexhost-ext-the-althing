// Desktop and Web expose their composer DOM, but no slash-command registry.
const composer = "[data-codex-composer-root],[data-composer-card]";
const editable = 'textarea,[contenteditable="true"]';
const command = /^\/althing(?:[ \t]+([^\r\n]+))?$/i;

export function installCouncilCommand(
  launch: (topic: string) => void,
  label: () => string,
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
    return raw.trimStart().startsWith("/") ? (editor.innerText ?? raw).trim() : "";
  }
  function hide() {
    button.remove();
    source = undefined;
  }
  function suggest(editor?: HTMLElement) {
    if (!editor || composing) return hide();
    const text = draft(editor);
    if (
      !text ||
      !("/althing".startsWith(text.toLowerCase()) || command.test(text))
    )
      return hide();
    source = editor;
    button.textContent = "/althing · " + label();
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
  function run(event: Event, editor?: HTMLElement, allowPrefix = false) {
    if (!editor || !editor.isConnected || composing) return;
    const text = draft(editor),
      match = command.exec(text);
    if (
      !match &&
      !(allowPrefix && text && "/althing".startsWith(text.toLowerCase()))
    )
      return;
    event.preventDefault();
    event.stopImmediatePropagation();
    // Apply a native editing operation so the host also updates its controlled draft.
    editor.focus({ preventScroll: true });
    if (editor instanceof HTMLTextAreaElement) {
      editor.setRangeText("", 0, editor.value.length, "end");
      editor.dispatchEvent(new Event("input", { bubbles: true }));
    } else {
      const selection = document.getSelection();
      if (selection) {
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
        const nativeDelete = editor.dispatchEvent(
          new InputEvent("beforeinput", {
            inputType: "deleteContentBackward",
            bubbles: true,
            cancelable: true,
          }),
        );
        if (
          nativeDelete &&
          draft(editor) === text &&
          selection.toString().trim() === text &&
          editor.contains(selection.anchorNode) &&
          editor.contains(selection.focusNode)
        )
          document.execCommand?.("delete");
      }
    }
    hide();
    launch(match?.[1]?.trim() || "");
  }
  function key(event: KeyboardEvent) {
    if (event.key === "Escape") {
      hide();
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
  function send(event: Event) {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const host =
      target.closest(composer) ??
      (event.type === "submit" ? target.querySelector(composer) : null);
    if (!host) return;
    if (event.type === "click") {
      const control = target.closest("button");
      if (!control || control === button) return;
      const name =
        control.getAttribute("aria-label") ||
        control.title ||
        control.dataset.testid ||
        "";
      if (
        !control.matches('[type="submit"]') &&
        !/^(?:send(?: message|-button)?|submit|发送(?:消息)?|提交)$/i.test(name)
      )
        return;
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
  return () => {
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
}
