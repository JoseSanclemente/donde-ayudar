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
let fab: HTMLButtonElement | null = null;
let tabs: HTMLButtonElement[] = [];
let collapsedY = 0;

export function isMobile(): boolean {
  return mobile.matches;
}

function getState(): State {
  return (sheet.dataset.state as State) ?? "collapsed";
}

function measure() {
  const peek = grab.offsetHeight + PEEK_CONTENT;
  // El sheet nunca se desplaza más allá de dejar solo el peek a la vista.
  collapsedY = Math.max(0, sheet.offsetHeight - peek);
  // El FAB se apoya sobre el peek, y el peek cambia con el alto del handle: un
  // valor fijo en CSS lo dejaba tapado en cuanto el sheet crecía.
  document.documentElement.style.setProperty("--peek", `${peek}px`);
}

/** El FAB estorba con el sheet arriba y ni se vería: solo vive con él abajo. */
function paintFab() {
  if (!fab) return;
  fab.hidden = sheet.dataset.tab === "reportar" || (isMobile() && getState() === "expanded");
}

function moveTo(state: State, animate = true) {
  sheet.dataset.state = state;
  paintFab();
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

// El pill activo se marca acá y no en CSS: una regla por pestaña obliga a tocar
// el stylesheet cada vez que se agrega una, y `aria-selected` además es lo que
// anuncia el lector de pantalla.
function paintTabs() {
  for (const button of tabs) {
    button.setAttribute("aria-selected", String(button.dataset.tabBtn === sheet.dataset.tab));
  }
  paintFab();
}

/**
 * Cambia de panel. En móvil el panel es exclusivo, así que abrir uno sube el
 * sheet; `expand: false` cambia de panel sin tocar la posición — es lo que hace
 * falta al cerrar el formulario después de enviarlo, con el sheet ya abajo.
 */
function showTab(tab: string, expand = true) {
  sheet.dataset.tab = tab;
  paintTabs();
  if (!isMobile()) return;
  measure();
  if (expand) moveTo("expanded");
  else if (getState() === "collapsed") gsap.set(sheet, { y: collapsedY });
}

export function openReportPanel(): void {
  showTab("reportar");
  if (isMobile()) return;
  // En escritorio el formulario aparece como una tarjeta más de la barra
  // lateral: si el scroll está abajo, abrirlo sin llevarlo a la vista no se ve.
  document.getElementById("form-card")?.scrollIntoView({ block: "start", behavior: "smooth" });
  document.getElementById("name")?.focus();
}

export function closeReportPanel(): void {
  if (sheet.dataset.tab !== "reportar") return;
  // Sin expandir: cerrar no es abrir otro panel, y al enviar el reporte el sheet
  // ya va camino abajo para dejar ver el marcador.
  showTab("puntos", false);
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
  paintFab();
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

  fab = document.getElementById("fab-report") as HTMLButtonElement | null;
  tabs = [...grab.querySelectorAll<HTMLButtonElement>("[data-tab-btn]")];

  for (const button of tabs) {
    button.addEventListener("click", () => showTab(button.dataset.tabBtn as string));
  }

  fab?.addEventListener("click", openReportPanel);
  document.getElementById("close-report")?.addEventListener("click", closeReportPanel);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeReportPanel();
  });

  paintTabs();

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
