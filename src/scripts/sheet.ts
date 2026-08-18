import gsap from "gsap";
import { clearSelection, refreshSize } from "./map";
import { isMobile, onBreakpointChange } from "./ui/breakpoint";

/**
 * Bottom sheet móvil: el panel (formulario + lista) se abre sobre el mapa a
 * pantalla completa y se cierra del todo.
 * Se abre desde el botón de menú (`#sheet-toggle`, encima del FAB) y se cierra
 * con la ✕ del encabezado, con el scrim o arrastrando hacia abajo.
 * En >=1024px el sheet es `display: contents` y este módulo no toca nada — el
 * layout de escritorio queda igual que siempre.
 *
 * A third state sits between the two: `peek`, where the sheet keeps a bit more
 * than half its height on screen. Nothing reaches it on its own — it is what
 * `peekSheet()` asks for when the form has just dropped a pin and the map above
 * has to be seen without losing the form.
 */

type State = "closed" | "open" | "peek";

const reduceMotion = window.matchMedia(
  "(prefers-reduced-motion: reduce)",
).matches;

const TAP_SLOP = 6;

let sheet: HTMLDivElement;
let grab: HTMLDivElement;
let body: HTMLDivElement | null = null;
let scrim: HTMLDivElement | null = null;
let fab: HTMLButtonElement | null = null;
let menu: HTMLButtonElement | null = null;
let funnel: HTMLButtonElement | null = null;
let pets: HTMLAnchorElement | null = null;
let tabs: HTMLButtonElement[] = [];

let closedY = 0;

let peekY = 0;

/** Quien quiera saber qué panel está a la vista. Un `Set` y no el emisor de
 * `data/`: los módulos de dominio no dependen de esa capa. */
const tabWatchers = new Set<() => void>();

function getState(): State {
  return (sheet.dataset.state as State) ?? "closed";
}

/** `true` si ese panel se está viendo: en escritorio siempre, en móvil solo
 * con el sheet fuera de su posición cerrada. */
export function isTabVisible(tab: string): boolean {
  if (!sheet || sheet.dataset.tab !== tab) return false;

  return !isMobile() || getState() !== "closed";
}

/** Pestañas con algo que mirar. The header dot is the panel's own mark; the
 * badge over the menu button is the union of them all, because with the sheet
 * closed the header is off screen and the button is the only thing left. */
const flagged = new Set<string>();

/**
 * Enciende o apaga el aviso de una pestaña. Los puntos viven acá y no en cada
 * feature: uno solo de ellos no sabe si otro panel también tiene algo, y el
 * badge del menú es justamente esa suma.
 */
export function setTabDot(tab: string, on: boolean): void {
  if (on) flagged.add(tab);
  else flagged.delete(tab);

  const dot = document.getElementById(`${tab}-dot`);
  if (dot) dot.hidden = !on;
  const badge = document.getElementById("menu-dot");
  if (badge) badge.hidden = flagged.size === 0;
}

export function onTabChange(fn: () => void): void {
  tabWatchers.add(fn);
}

function notifyTabWatchers() {
  for (const fn of tabWatchers) fn();
}

/**
 * El contenido siempre empieza arriba. El scroll vive en `#sheet-body`, que es
 * el mismo para todas las pestañas: sin esto, abrir el sheet o cambiar de panel
 * hereda el scroll del anterior y el nuevo arranca por la mitad. En escritorio
 * el elemento es `display: contents` y no tiene scroll propio, así que no pasa
 * nada.
 */
function scrollToTop() {
  if (body) body.scrollTop = 0;
}

function measure() {
  closedY = sheet.offsetHeight + 24;
  peekY = Math.min(Math.round(sheet.offsetHeight * 0.45), closedY);
}

/**
 * How much of the viewport the sheet covers right now, in pixels. Zero on
 * desktop and when closed. Whoever moves the map while the sheet is up needs
 * it: the container centre is under the panel, so the target has to be pushed
 * into the strip that is left.
 */
export function getSheetCover(): number {
  if (!sheet || !isMobile()) return 0;
  const state = getState();
  if (state === "closed") return 0;
  return state === "peek"
    ? Math.max(0, sheet.offsetHeight - peekY)
    : sheet.offsetHeight;
}

/**
 * Los botones flotantes viven con el sheet cerrado: abierto los taparía y el
 * sheet ya trae su propia ✕. El FAB además se esconde con el formulario ya
 * a la vista — sería un botón que no lleva a ningún lado. Pero solo a la
 * vista: cerrar el sheet con el formulario abierto lo deja en `reportar` sin
 * que se vea nada, y ahí el FAB es justo lo que hace falta para volver.
 *
 * El de centrar no está acá: vive arriba a la derecha, con el zoom, y el sheet
 * no llega hasta allá. Esconderlo mientras los dos botones de encima se quedan
 * quietos se vería como una falla.
 */
function paintControls() {
  const covered = isMobile() && getState() !== "closed";
  if (fab) fab.hidden = isTabVisible("reportar") || covered;
  if (menu) menu.hidden = !isMobile() || covered;

  if (funnel) {
    funnel.hidden = covered;
    funnel.setAttribute("aria-expanded", String(isTabVisible("filtros")));
  }

  if (pets) pets.hidden = covered;
}

function paintScrim(state: State, animate: boolean) {
  if (!scrim) return;
  if (!isMobile()) {
    gsap.set(scrim, { opacity: 0 });
    scrim.hidden = true;
    return;
  }
  gsap.killTweensOf(scrim);

  if (state === "open") {
    scrim.hidden = false;
    if (!animate || reduceMotion) gsap.set(scrim, { opacity: 1 });
    else gsap.to(scrim, { opacity: 1, duration: 0.35, ease: "power3.out" });
    return;
  }
  if (!animate || reduceMotion) {
    gsap.set(scrim, { opacity: 0 });
    scrim.hidden = true;
    return;
  }
  gsap.to(scrim, {
    opacity: 0,
    duration: 0.3,
    ease: "power3.out",

    onComplete: () => {
      if (getState() !== "open" && scrim) scrim.hidden = true;
    },
  });
}

function offsetFor(state: State): number {
  if (state === "open") return 0;
  return state === "peek" ? peekY : closedY;
}

function moveTo(state: State, animate = true) {
  sheet.dataset.state = state;
  paintControls();
  notifyTabWatchers();
  paintScrim(state, animate);

  if (state === "closed") measure();
  const y = offsetFor(state);
  if (!animate || reduceMotion) {
    gsap.set(sheet, { y });
    return;
  }
  gsap.to(sheet, {
    y,
    duration: 0.35,
    ease: "power3.out",

    onComplete: () => {
      if (getState() !== "closed") return;
      measure();
      gsap.set(sheet, { y: closedY });
    },
  });
}

export function openSheet(): void {
  if (!isMobile() || getState() === "open") return;

  if (getState() !== "peek") scrollToTop();
  measure();
  moveTo("open");
}

/**
 * Lowers the sheet without closing it: the map above becomes visible while the
 * form stays on screen. Only from `open` — nothing else has anything to lower.
 */
export function peekSheet(): void {
  if (!isMobile() || getState() !== "open") return;
  measure();
  moveTo("peek");
}

export function closeSheet(): void {
  if (!isMobile() || getState() === "closed") return;

  closeDetailPanel();
  moveTo("closed");
}

function paintTabs() {
  for (const button of tabs) {
    button.setAttribute(
      "aria-selected",
      String(button.dataset.tabBtn === sheet.dataset.tab),
    );
  }
  for (const panel of sheet.querySelectorAll<HTMLElement>("[data-tab-panel]")) {
    panel.toggleAttribute(
      "data-active",
      panel.dataset.tabPanel === sheet.dataset.tab,
    );
  }
  const tab = sheet.dataset.tab;
  sheet.dataset.tall = String(tab !== "reportar" && tab !== "filtros");
  paintControls();
  notifyTabWatchers();
}

/**
 * Cambia de panel. En móvil el panel es exclusivo, así que abrir uno abre el
 * sheet; `open: false` cambia de panel sin tocar la posición — es lo que hace
 * falta al cerrar el formulario después de enviarlo, con el sheet ya cerrado.
 */
function showTab(tab: string, open = true) {
  if (sheet.dataset.tab === "detalle" && tab !== "detalle") clearSelection();
  sheet.dataset.tab = tab;
  paintTabs();
  scrollToTop();
  if (!isMobile()) return;
  measure();
  if (open) moveTo("open");
  else if (getState() !== "open") gsap.set(sheet, { y: offsetFor(getState()) });
}

export function openReportPanel(): void {
  showTab("reportar");
  if (isMobile()) return;

  document.getElementById("report-name")?.focus();
}

export function closeReportPanel(): void {
  if (sheet.dataset.tab !== "reportar") return;

  showTab("puntos", false);
}

/**
 * The city log. Unlike the form or the detail, this one does have its button in
 * the tablist — the banner in the header is a second door to it, for the newest
 * novedad, which on mobile is otherwise behind a closed sheet.
 */
export function openUpdatesPanel(): void {
  showTab("novedades");
}

/**
 * El detalle de un marcador. Es una pestaña sin botón en el tablist, como
 * `reportar`: no se llega desde el encabezado sino tocando un punto del mapa.
 */
export function openDetailPanel(): void {
  showTab("detalle");
}

export function closeDetailPanel(): void {
  if (sheet.dataset.tab !== "detalle") return;

  showTab("puntos", false);
}

/**
 * El filtro del mapa. Otra pestaña sin botón en el tablist: se llega por el
 * embudo flotante y por nada más. En escritorio `showTab` no mueve el sheet —
 * solo cambia `data-tab`, que es lo que el stylesheet lee para sacar el popover.
 */
export function openFilterPanel(): void {
  showTab("filtros");
}

export function closeFilterPanel(): void {
  if (sheet.dataset.tab !== "filtros") return;

  showTab("puntos", false);
}

function applyBreakpoint() {
  if (!isMobile()) {
    gsap.set(sheet, { clearProps: "transform" });
    paintScrim("closed", false);
  } else {
    measure();
    moveTo(getState(), false);
  }
  paintControls();
  notifyTabWatchers();
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

    if ((event.target as HTMLElement).closest('button, [role="tablist"]'))
      return;

    dragging = true;
    moved = 0;
    velocity = 0;
    startY = lastY = event.clientY;
    lastTime = event.timeStamp;
    startTranslate =
      (gsap.getProperty(sheet, "y") as number) ?? offsetFor(getState());
    grab.setPointerCapture(event.pointerId);
    gsap.killTweensOf(sheet);
  });

  grab.addEventListener("pointermove", (event: PointerEvent) => {
    if (!dragging) return;
    const delta = event.clientY - startY;
    moved = Math.max(moved, Math.abs(delta));

    const dt = event.timeStamp - lastTime;
    if (dt > 0) velocity = (event.clientY - lastY) / dt;
    lastY = event.clientY;
    lastTime = event.timeStamp;

    const y = Math.min(closedY, Math.max(0, startTranslate + delta));
    gsap.set(sheet, { y });

    if (scrim && !scrim.hidden) gsap.set(scrim, { opacity: 1 - y / closedY });
  });

  const end = (event: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    if (grab.hasPointerCapture(event.pointerId))
      grab.releasePointerCapture(event.pointerId);

    if (moved < TAP_SLOP) {
      moveTo(getState() === "open" ? "closed" : "open");
      return;
    }

    if (Math.abs(velocity) > 0.5) {
      if (velocity < 0) moveTo("open");
      else moveTo(getState() === "open" ? "peek" : "closed");
      return;
    }
    const y = (gsap.getProperty(sheet, "y") as number) ?? closedY;
    const states: State[] = ["open", "peek", "closed"];
    let nearest: State = "closed";
    let best = Infinity;
    for (const state of states) {
      const distance = Math.abs(y - offsetFor(state));
      if (distance < best) {
        best = distance;
        nearest = state;
      }
    }
    moveTo(nearest);
  };

  grab.addEventListener("pointerup", end);
  grab.addEventListener("pointercancel", end);
}

export function initSheet(): void {
  sheet = document.getElementById("sheet") as HTMLDivElement;
  grab = document.getElementById("sheet-grab") as HTMLDivElement;
  if (!sheet || !grab) return;

  body = document.getElementById("sheet-body") as HTMLDivElement | null;
  scrim = document.getElementById("sheet-scrim") as HTMLDivElement | null;
  fab = document.getElementById("fab-report") as HTMLButtonElement | null;
  menu = document.getElementById("sheet-toggle") as HTMLButtonElement | null;
  funnel = document.getElementById("fab-filter") as HTMLButtonElement | null;
  pets = document.getElementById("fab-pets") as HTMLAnchorElement | null;
  tabs = [...grab.querySelectorAll<HTMLButtonElement>("[data-tab-btn]")];

  for (const button of tabs) {
    button.addEventListener("click", () =>
      showTab(button.dataset.tabBtn as string),
    );
  }

  const raiseFromPeek = () => {
    if (getState() === "peek") openSheet();
  };
  body?.addEventListener("pointerdown", raiseFromPeek);
  body?.addEventListener("focusin", raiseFromPeek);

  menu?.addEventListener("click", () => {
    const tab = sheet.dataset.tab;
    if (tab === "reportar" || tab === "detalle" || tab === "filtros")
      showTab("puntos");
    else openSheet();
  });
  scrim?.addEventListener("click", closeSheet);
  document.getElementById("sheet-close")?.addEventListener("click", closeSheet);

  fab?.addEventListener("click", openReportPanel);

  funnel?.addEventListener("click", () => {
    if (isTabVisible("filtros")) closeFilterPanel();
    else openFilterPanel();
  });

  document.addEventListener("pointerdown", (event) => {
    if (isMobile() || !isTabVisible("filtros")) return;
    const target = event.target as HTMLElement;
    if (target.closest("#filters-card") || target.closest("#fab-filter"))
      return;
    closeFilterPanel();
  });

  document
    .getElementById("close-report")
    ?.addEventListener("click", closeReportPanel);
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;

    if (sheet.dataset.tab === "reportar") closeReportPanel();
    else if (isTabVisible("filtros")) closeFilterPanel();
    else closeSheet();
  });

  paintTabs();

  initDrag();

  new ResizeObserver(() => {
    if (!isMobile()) return;

    if (gsap.isTweening(sheet)) return;
    measure();
    if (getState() !== "open") gsap.set(sheet, { y: offsetFor(getState()) });
  }).observe(sheet);

  let resizeTimer = 0;
  window.addEventListener("resize", () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(applyBreakpoint, 150);
  });
  onBreakpointChange(applyBreakpoint);

  applyBreakpoint();
}
