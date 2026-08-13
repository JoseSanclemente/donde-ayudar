/**
 * The one select of the site, in the two shapes it takes: `field` — the form
 * control, white and full width — and `chip` — the status pill, transparent and
 * painted with the colour of the state.
 *
 * It exists because the same control was styled by hand in five places and no
 * two of them agreed. What is shared here is only the closed control: classes
 * and the caret. The open menu is the native one, normalised in `global.css`.
 *
 * The native arrow is drawn by the browser against the edge of the element,
 * outside the flow, so no padding moves it: on the pill it sat on top of the
 * round corner. It is turned off with `appearance-none` and drawn as one more
 * glyph, which does respect the padding and inherits the colour.
 *
 * Tailwind classes are spelled out literally, same rule as `resources.ts`: the
 * scanner reads this file as plain text.
 *
 * It knows neither the stores nor the features: whoever listens for the
 * `change` is a feature.
 */

export type SelectVariant = "field" | "chip";

/** Relative so the caret of the `field` variant can sit over the control. */
export const SELECT_FIELD_WRAP = "relative flex items-center";

/**
 * `pr-9` is the room the caret needs: it is drawn over the select, not next to
 * it, so without it a long option name runs under the arrow.
 */
export const SELECT_FIELD =
  "w-full min-w-0 cursor-pointer appearance-none rounded-lg border border-slate-300 bg-white px-3 py-2 pr-9 text-sm text-slate-700 shadow-sm outline-none focus:border-slate-400";

/**
 * `flex-1` is what makes the whole pill open the menu. The chip stretches to
 * the full width of the mobile sheet (`#detail-body` lays it out as a flex
 * column), and a select sized to its label leaves the rest of the pill dead.
 */
export const SELECT_CHIP =
  "min-w-0 flex-1 cursor-pointer appearance-none border-0 bg-transparent p-0 font-semibold text-inherit outline-none";

const CARET_CLASS: Record<SelectVariant, string> = {
  field:
    "pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[0.65rem] text-slate-500",
  chip: "pointer-events-none text-[0.65rem] opacity-70",
};

/** The glyph itself, shared with the disclosure caret of «Zonas reportadas». */
export const CARET = "▾";

export function caretHtml(variant: SelectVariant): string {
  return `<span aria-hidden="true" class="${CARET_CLASS[variant]}">${CARET}</span>`;
}

export function buildCaret(variant: SelectVariant): HTMLSpanElement {
  const caret = document.createElement("span");
  caret.className = CARET_CLASS[variant];
  caret.setAttribute("aria-hidden", "true");
  caret.textContent = CARET;
  return caret;
}
