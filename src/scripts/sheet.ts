import gsap from "gsap";
import { refreshSize } from "./map";

/**
 * Bottom sheet móvil: el panel (formulario + lista) se arrastra sobre el mapa
 * a pantalla completa. En >=1024px el sheet es `display: contents` y este
 * módulo no toca nada — el layout de escritorio queda igual que siempre.
 */

type State = "collapsed" | "expanded";

const mobile = window.matchMedia("(max-width: 1023px)");
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Alto visible del sheet colapsado, además del handle + pestañas. */
const PEEK_CONTENT = 108;
/** Un arrastre más corto que esto cuenta como tap. */
const TAP_SLOP = 6;

let sheet: HTMLDivElement;
let grab: HTMLDivElement;
let collapsedY = 0;

export function isMobile(): boolean {
  return mobile.matches;
}

function getState(): State {
  return (sheet.dataset.state as State) ?? "collapsed";
}

function measure() {
  // El sheet nunca se desplaza más allá de dejar solo el peek a la vista.
  collapsedY = Math.max(0, sheet.offsetHeight - (grab.offsetHeight + PEEK_CONTENT));
}

function moveTo(state: State, animate = true) {
  sheet.dataset.state = state;
  const y = state === "expanded" ? 0 : collapsedY;
  if (!animate || reduceMotion) {
    gsap.set(sheet, { y });
    return;
  }
  gsap.to(sheet, { y, duration: 0.35, ease: "power3.out" });
}

export function expandSheet(): void {
  if (!isMobile() || getState() === "expanded") return;
  moveTo("expanded");
}

export function collapseSheet(): void {
  if (!isMobile() || getState() === "collapsed") return;
  moveTo("collapsed");
}

function toggle() {
  if (getState() === "expanded") moveTo("collapsed");
  else moveTo("expanded");
}

function applyBreakpoint() {
  if (!isMobile()) {
    // En escritorio el transform sobraría: el sheet vuelve al flujo normal.
    gsap.set(sheet, { clearProps: "transform" });
  } else {
    measure();
    moveTo(getState(), false);
  }
  refreshSize();
}

function initDrag() {
  let startY = 0;
  let startTranslate = 0;
  let lastY = 0;
  let lastTime = 0;
  let velocity = 0;
  let dragging = false;
  let moved = 0;

  grab.addEventListener("pointerdown", (event: PointerEvent) => {
    if (!isMobile()) return;
    // Los botones de pestaña se manejan con su propio click.
    if ((event.target as HTMLElement).closest("[data-tab-btn]")) return;

    dragging = true;
    moved = 0;
    velocity = 0;
    startY = lastY = event.clientY;
    lastTime = event.timeStamp;
    startTranslate = getState() === "expanded" ? 0 : collapsedY;
    grab.setPointerCapture(event.pointerId);
    gsap.killTweensOf(sheet);
  });

  grab.addEventListener("pointermove", (event: PointerEvent) => {
    if (!dragging) return;
    const delta = event.clientY - startY;
    moved = Math.max(moved, Math.abs(delta));

    const dt = event.timeStamp - lastTime;
    if (dt > 0) velocity = (event.clientY - lastY) / dt; // px/ms, + hacia abajo
    lastY = event.clientY;
    lastTime = event.timeStamp;

    gsap.set(sheet, { y: Math.min(collapsedY, Math.max(0, startTranslate + delta)) });
  });

  const end = (event: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    if (grab.hasPointerCapture(event.pointerId)) grab.releasePointerCapture(event.pointerId);

    if (moved < TAP_SLOP) {
      toggle();
      return;
    }

    // Un flick rápido gana sobre la posición; si no, manda el punto medio.
    if (Math.abs(velocity) > 0.5) {
      moveTo(velocity > 0 ? "collapsed" : "expanded");
      return;
    }
    const y = (gsap.getProperty(sheet, "y") as number) ?? collapsedY;
    moveTo(y < collapsedY / 2 ? "expanded" : "collapsed");
  };

  grab.addEventListener("pointerup", end);
  grab.addEventListener("pointercancel", end);
}

export function initSheet(): void {
  sheet = document.getElementById("sheet") as HTMLDivElement;
  grab = document.getElementById("sheet-grab") as HTMLDivElement;
  if (!sheet || !grab) return;

  for (const button of grab.querySelectorAll<HTMLButtonElement>("[data-tab-btn]")) {
    button.addEventListener("click", () => {
      sheet.dataset.tab = button.dataset.tabBtn;
      measure();
      moveTo("expanded");
    });
  }

  initDrag();

  // El alto del sheet cambia al abrir acordeones o al crecer la lista.
  new ResizeObserver(() => {
    if (!isMobile()) return;
    measure();
    if (getState() === "collapsed") gsap.set(sheet, { y: collapsedY });
  }).observe(sheet);

  let resizeTimer = 0;
  window.addEventListener("resize", () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(applyBreakpoint, 150);
  });
  mobile.addEventListener("change", applyBreakpoint);

  applyBreakpoint();
}
