/**
 * The amber dot that says «there is something new here», in the two ways the
 * site builds markup: as an element, for the lists made in the DOM, and through
 * `NewDot.astro` for the ones written as markup.
 *
 * It was hand-written in three places — the two tabs and the sheet toggle — and
 * the pulse would have made that three copies of an animation to keep in step.
 * The movement itself lives in `global.css` under `.new-dot`.
 *
 * Tailwind classes are spelled out literally, same rule as `resources.ts`: the
 * scanner reads this file as plain text.
 */

export const NEW_DOT = "new-dot h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400";

/**
 * A label turns the dot into something a screen reader announces; without one it
 * is decoration, and the text beside it already carries the meaning.
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
