/**
 * Pixel coordinates of a caret position within a <textarea>, using the
 * standard hidden-mirror technique: a div that copies the textarea's text
 * styling, with a marker span at the caret. Returns the marker's offset
 * relative to the textarea's border-box (before scroll is applied).
 */
export function caretCoordinates(
  el: HTMLTextAreaElement,
  position: number
): { top: number; left: number; height: number } {
  const cs = window.getComputedStyle(el);
  const div = document.createElement("div");
  const style = div.style;

  // Copy the properties that affect text layout.
  const props = [
    "boxSizing",
    "width",
    "fontFamily",
    "fontSize",
    "fontWeight",
    "fontStyle",
    "letterSpacing",
    "lineHeight",
    "textTransform",
    "wordSpacing",
    "paddingTop",
    "paddingRight",
    "paddingBottom",
    "paddingLeft",
    "borderTopWidth",
    "borderRightWidth",
    "borderBottomWidth",
    "borderLeftWidth",
    "tabSize",
    "overflowWrap",
    "wordBreak",
  ] as const;

  style.position = "absolute";
  style.visibility = "hidden";
  // Match the editor's wrap mode ("pre" normally, "pre-wrap" when wrapping).
  style.whiteSpace = cs.whiteSpace || "pre";
  style.overflow = "hidden";
  for (const p of props) {
    style[p] = cs[p];
  }

  div.textContent = el.value.slice(0, position);
  const span = document.createElement("span");
  span.textContent = el.value.slice(position) || ".";
  div.appendChild(span);

  document.body.appendChild(div);
  const top = span.offsetTop;
  const left = span.offsetLeft;
  const height = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2;
  document.body.removeChild(div);

  return { top, left, height };
}
