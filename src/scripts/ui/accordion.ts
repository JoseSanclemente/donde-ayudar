import { $ } from "./dom";

/**
 * The sidebar cards that fold: a `<section data-panel-card>` with its
 * `[data-card-body]` inside, a button and a caret. The rule that hides the body
 * lives behind the desktop media query, so on mobile — where each card is a
 * whole tab of the sheet — `data-collapsed` does nothing and this is only the
 * `aria-expanded` a screen reader announces.
 *
 * They all open closed: the sidebar opens on the map, not on a form.
 */
export function initAccordion(prefix: string, cardId = `${prefix}-panel-card`): void {
  const card = $<HTMLElement>(cardId);
  const toggle = $<HTMLButtonElement>(`${prefix}-toggle`);
  const caret = $<HTMLSpanElement>(`${prefix}-caret`);

  card.dataset.collapsed = "true";
  toggle.addEventListener("click", () => {
    const open = card.dataset.collapsed === "true";
    card.dataset.collapsed = String(!open);
    toggle.setAttribute("aria-expanded", String(open));
    caret.textContent = open ? "▴" : "▾";
  });
}
