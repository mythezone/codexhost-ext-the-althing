/** Measure rendered boxes, including content below the fold. Scrollports themselves must fit. */
export function measureBounds(root: HTMLElement, width: number) {
  const problems: { element: string; edge: string; pixels: number }[] = [];
  let boxes = 0;
  if (root.scrollWidth > root.clientWidth + 1)
    problems.push({
      element: "root",
      edge: "scroll",
      pixels: root.scrollWidth - root.clientWidth,
    });
  for (const el of root.querySelectorAll("*")) {
    if (
      el.parentElement?.closest(".table-scroll, pre, svg") ||
      el.matches("option, optgroup")
    )
      continue;
    const closed = el.parentElement?.closest("details:not([open])");
    if (closed && !closed.querySelector(":scope > summary")?.contains(el))
      continue;
    const rect = el.getBoundingClientRect();
    if (
      !rect.width ||
      !rect.height ||
      getComputedStyle(el).visibility === "hidden"
    )
      continue;
    boxes++;
    const panel = el.parentElement?.closest(
      ".panel, .topic-card, dialog[open]",
    );
    const bounds = panel?.getBoundingClientRect();
    const left = Math.max(0, bounds?.left ?? 0) - rect.left;
    const right = rect.right - Math.min(width, bounds?.right ?? width);
    const element = el.localName + "." + (el.getAttribute("class") || "");
    if (rect.left < 0 || left > 1)
      problems.push({ element, edge: "left", pixels: left });
    if (right > 1) problems.push({ element, edge: "right", pixels: right });
  }
  return { boxes, problems };
}
