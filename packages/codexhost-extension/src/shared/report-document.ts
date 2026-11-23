import { parse, type DefaultTreeAdapterTypes } from "parse5";
import { tableCss, readerCss } from "../backend/domain/publication.json";

const literalContexts = new Set([
  "code",
  "pre",
  "script",
  "style",
  "textarea",
  "title",
  "iframe",
  "xmp",
  "noscript",
  "plaintext",
]);

/** Edit only the original source ranges so CSP-hashed scripts and authored srcdoc stay byte-identical. */
export function reportDocument(source: string, dark: boolean): string {
  const doc = parse(source, { sourceCodeLocationInfo: true });
  const edits: { offset: number; end?: number; text: string }[] = [];
  let headEnd = 0;
  let hasStyles = false;
  function visit(parent: DefaultTreeAdapterTypes.ParentNode) {
    for (const node of parent.childNodes) {
      if (node.nodeName === "#text" && node.sourceCodeLocation) {
        const loc = node.sourceCodeLocation;
        const raw = source.slice(loc.startOffset, loc.endOffset);
        // Malformed tables can produce one text-node range spanning intervening markup.
        if (/<[a-z/!?]/i.test(raw)) continue;
        for (const match of raw.matchAll(
          /&lt;(\/?)(br|wbr|sup|sub|hr)\s*\/?&gt;/gi,
        )) {
          const tag = match[2].toLowerCase();
          const closing = match[1];
          if (closing && (tag === "br" || tag === "wbr")) continue;
          const offset = loc.startOffset + match.index;
          edits.push({
            offset,
            end: offset + match[0].length,
            text: "<" + closing + tag + ">",
          });
        }
      }
      if (!("tagName" in node)) continue;
      const loc = node.sourceCodeLocation;
      if (node.tagName === "head")
        headEnd = loc?.endTag?.startOffset ?? loc?.endOffset ?? 0;
      if (
        node.tagName === "style" &&
        node.attrs.some((a) => a.name === "data-althing-mobile-tables") &&
        node.childNodes.some(
          (child) => "value" in child && child.value.includes(tableCss),
        )
      )
        hasStyles = true;
      if (
        node.tagName === "html" &&
        dark &&
        loc?.startTag &&
        !node.attrs.some((a) => a.name === "data-dark")
      )
        edits.push({
          offset: loc.startTag.endOffset - 1,
          text: " data-dark",
        });
      if (node.tagName === "table" && loc) {
        const wrapped =
          "attrs" in parent &&
          parent.attrs.some(
            (a) =>
              a.name === "class" &&
              a.value.split(/\s+/).includes("table-scroll"),
          );
        if (!wrapped) {
          edits.push({
            offset: loc.startOffset,
            text: '<div class="table-scroll" role="region" tabindex="0">',
          });
          edits.push({ offset: loc.endOffset, text: "</div>" });
        }
      }
      if (!literalContexts.has(node.tagName)) visit(node);
    }
  }
  visit(doc);
  if (!hasStyles)
    edits.push({
      offset: headEnd,
      text:
        "<style data-althing-mobile-tables>" +
        tableCss +
        readerCss +
        "</style>",
    });
  let cursor = 0;
  const output: string[] = [];
  for (const { offset, end, text } of edits.sort(
    (a, b) => a.offset - b.offset,
  )) {
    output.push(source.slice(cursor, offset), text);
    cursor = end ?? offset;
  }
  return output.join("") + source.slice(cursor);
}
