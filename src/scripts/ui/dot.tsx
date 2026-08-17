import {
  NEW_DOT,
  NewDot,
  type NewDotProps,
} from "@/components/ui/NewDot";

export { NEW_DOT, NewDot, type NewDotProps };
export default NewDot;

/**
 * Builds an HTMLSpanElement for imperative DOM rendering.
 */
export function buildNewDot(extra = "", label = ""): HTMLSpanElement {
  const dot = document.createElement("span");
  dot.className = `${NEW_DOT} ${extra}`.trim();
  if (label) {
    const text = document.createElement("span");
    text.className = "sr-only";
    text.textContent = label;
    dot.append(text);
  } else {
    dot.setAttribute("aria-hidden", "true");
  }
  return dot;
}
