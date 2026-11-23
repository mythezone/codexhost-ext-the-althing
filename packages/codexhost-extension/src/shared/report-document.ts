import { parse, type DefaultTreeAdapterTypes } from "parse5";
import { tableCss, readerCss } from "../backend/domain/publication.json";

/** Add layout around original source ranges so CSP-hashed scripts and authored srcdoc stay byte-identical. */
export function reportDocument(source: string, dark: boolean): string {
  const doc = parse(source, { sourceCodeLocationInfo: true });
  const insertions: { offset: number; text: string }[] = [];
  let headEnd = 0;
  let hasStyles = false;
  function visit(parent: DefaultTreeAdapterTypes.ParentNode) {
    for (const node of parent.childNodes) {
      if (!("tagName" in node)) continue;
      const loc = node.sourceCodeLocation;
      if (node.tagName === "head")
        headEnd = loc?.endTag?.startOffset ?? loc?.endOffset ?? 0;
      if (
        node.tagName === "style" &&
        node.attrs.some((a) => a.name === "data-althing-mobile-tables")
      )
        hasStyles = true;
      if (
        node.tagName === "html" &&
        dark &&
        loc?.startTag &&
        !node.attrs.some((a) => a.name === "data-dark")
      )
        insertions.push({
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
          insertions.push({
            offset: loc.startOffset,
            text: '<div class="table-scroll" role="region" tabindex="0">',
          });
          insertions.push({ offset: loc.endOffset, text: "</div>" });
        }
      }
      visit(node);
    }
  }
  visit(doc);
  if (!hasStyles)
    insertions.push({
      offset: headEnd,
      text:
        "<style data-althing-mobile-tables>" +
        tableCss +
        readerCss +
        "</style>",
    });
  let cursor = 0;
  const output: string[] = [];
  for (const { offset, text } of insertions.sort(
    (a, b) => a.offset - b.offset,
  )) {
    output.push(source.slice(cursor, offset), text);
    cursor = offset;
  }
  return output.join("") + source.slice(cursor);
}
