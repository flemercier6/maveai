// Compute the pixel offset of the caret inside a textarea relative to the textarea itself.
// Uses a hidden mirror div technique.
export function getTextareaCaretCoords(
  textarea: HTMLTextAreaElement,
  position: number,
): { left: number; top: number; height: number } {
  const div = document.createElement("div");
  const style = div.style;
  const computed = window.getComputedStyle(textarea);

  // Mirror styles that affect text wrapping & layout
  const props = [
    "boxSizing",
    "width",
    "height",
    "overflowX",
    "overflowY",
    "borderTopWidth",
    "borderRightWidth",
    "borderBottomWidth",
    "borderLeftWidth",
    "borderStyle",
    "paddingTop",
    "paddingRight",
    "paddingBottom",
    "paddingLeft",
    "fontStyle",
    "fontVariant",
    "fontWeight",
    "fontStretch",
    "fontSize",
    "fontSizeAdjust",
    "lineHeight",
    "fontFamily",
    "textAlign",
    "textTransform",
    "textIndent",
    "textDecoration",
    "letterSpacing",
    "wordSpacing",
    "tabSize",
    "MozTabSize",
  ] as const;

  style.position = "absolute";
  style.visibility = "hidden";
  style.whiteSpace = "pre-wrap";
  style.wordWrap = "break-word";
  style.top = "0";
  style.left = "-9999px";

  for (const prop of props) {
    // @ts-ignore - dynamic css property assignment
    style[prop] = computed[prop];
  }

  div.textContent = textarea.value.substring(0, position);
  const span = document.createElement("span");
  // Use the next char (or a placeholder) so the span has dimensions
  span.textContent = textarea.value.substring(position) || ".";
  div.appendChild(span);
  document.body.appendChild(div);

  const left = span.offsetLeft - textarea.scrollLeft;
  const top = span.offsetTop - textarea.scrollTop;
  const height = parseInt(computed.lineHeight, 10) || span.offsetHeight;

  document.body.removeChild(div);
  return { left, top, height };
}
