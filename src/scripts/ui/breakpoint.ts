/**
 * El único lugar donde vive el corte entre móvil y escritorio. Lo consultan el
 * sheet y el mapa, y `map.ts` no puede preguntárselo a `sheet.ts` porque el
 * sheet ya importa del mapa — de ahí que el media query viva acá, en `ui/`.
 */

const mobile = window.matchMedia("(max-width: 1023px)");

export function isMobile(): boolean {
  return mobile.matches;
}

/** Se dispara al cruzar el corte, no en cada píxel de un `resize`. */
export function onBreakpointChange(handler: () => void): void {
  mobile.addEventListener("change", handler);
}
