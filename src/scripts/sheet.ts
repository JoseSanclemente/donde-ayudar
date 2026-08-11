import gsap from "gsap";
import { refreshSize } from "./map";

/**
 * Bottom sheet móvil: el panel (formulario + lista) se abre sobre el mapa a
 * pantalla completa y se cierra del todo — no queda un peek tapando el mapa.
 * Se abre desde el botón de menú (`#sheet-toggle`, encima del FAB) y se cierra
 * con la ✕ del encabezado, con el scrim o arrastrando hacia abajo.
 * En >=1024px el sheet es `display: contents` y este módulo no toca nada — el
 * layout de escritorio queda igual que siempre.
 */

type State = "closed" | "open";

const mobile = window.matchMedia("(max-width: 1023px)");
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Un arrastre más corto que esto cuenta como tap. */
const TAP_SLOP = 6;

let sheet: HTMLDivElement;
let grab: HTMLDivElement;
let scrim: HTMLDivElement | null = null;
let fab: HTMLButtonElement | null = null;
let menu: HTMLButtonElement | null = null;
let tabs: HTMLButtonElement[] = [];
/** Desplazamiento que deja el sheet completamente fuera de la pantalla. */
let closedY = 0;

export function isMobile(): boolean {
  return mobile.matches;
}

function getState(): State {
  return (sheet.dataset.state as State) ?? "closed";
}

function measure() {
  // Cerrado el sheet sale entero: el mapa queda libre y el único acceso son los
  // botones flotantes. El extra cubre la sombra, que si no asoma por abajo.
  closedY = sheet.offsetHeight + 24;
}

/**
 * Los botones flotantes viven con el sheet cerrado: abierto los taparía y el
 * sheet ya trae su propia ✕. El FAB además se esconde con el formulario ya
 * abierto — sería un botón que no lleva a ningún lado.
 */
function paintControls() {
  const covered = isMobile() && getState() === "open";
  if (fab) fab.hidden = sheet.dataset.tab === "reportar" || covered;
  if (menu) menu.hidden = !isMobile() || covered;
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
    // Ocultarlo antes de que termine el fundido dejaría el scrim parpadeando;
    // y si mientras tanto se volvió a abrir, no hay que tocarlo.
    onComplete: () => {
      if (getState() === "closed" && scrim) scrim.hidden = true;
    },
  });
}

function moveTo(state: State, animate = true) {
  sheet.dataset.state = state;
  paintControls();
  paintScrim(state, animate);
  const y = state === "open" ? 0 : closedY;
  if (!animate || reduceMotion) {
    gsap.set(sheet, { y });
    return;
  }
  gsap.to(sheet, { y, duration: 0.35, ease: "power3.out" });
}

export function openSheet(): void {
  if (!isMobile() || getState() === "open") return;
  measure();
  moveTo("open");
}

export function closeSheet(): void {
  if (!isMobile() || getState() === "closed") return;
  moveTo("closed");
}

// El pill activo se marca acá y no en CSS: una regla por pestaña obliga a tocar
// el stylesheet cada vez que se agrega una, y `aria-selected` además es lo que
// anuncia el lector de pantalla.
function paintTabs() {
  for (const button of tabs) {
    button.setAttribute("aria-selected", String(button.dataset.tabBtn === sheet.dataset.tab));
  }
  paintControls();
}

/**
 * Cambia de panel. En móvil el panel es exclusivo, así que abrir uno abre el
 * sheet; `open: false` cambia de panel sin tocar la posición — es lo que hace
 * falta al cerrar el formulario después de enviarlo, con el sheet ya cerrado.
 */
function showTab(tab: string, open = true) {
  sheet.dataset.tab = tab;
  paintTabs();
  if (!isMobile()) return;
  measure();
  if (open) moveTo("open");
  else if (getState() === "closed") gsap.set(sheet, { y: closedY });
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
  // Sin abrir: cerrar el formulario no es abrir otro panel, y al enviar el
  // reporte el sheet ya va camino abajo para dejar ver el marcador.
  showTab("puntos", false);
}

function applyBreakpoint() {
  if (!isMobile()) {
    // En escritorio el transform sobraría: el sheet vuelve al flujo normal.
    gsap.set(sheet, { clearProps: "transform" });
    paintScrim("closed", false);
  } else {
    measure();
    moveTo(getState(), false);
  }
  paintControls();
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
    // Los botones del encabezado (pestañas, ✕) se manejan con su propio click.
    if ((event.target as HTMLElement).closest("button")) return;

    dragging = true;
    moved = 0;
    velocity = 0;
    startY = lastY = event.clientY;
    lastTime = event.timeStamp;
    startTranslate = getState() === "open" ? 0 : closedY;
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

    const y = Math.min(closedY, Math.max(0, startTranslate + delta));
    gsap.set(sheet, { y });
    // El scrim sigue al dedo: si no, se quedaría opaco hasta soltar y el
    // arrastre no se sentiría como si estuviera cerrando algo.
    if (scrim && !scrim.hidden) gsap.set(scrim, { opacity: 1 - y / closedY });
  });

  const end = (event: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    if (grab.hasPointerCapture(event.pointerId)) grab.releasePointerCapture(event.pointerId);

    // Tap en el handle con el sheet abierto: lo cierra, igual que la ✕.
    if (moved < TAP_SLOP) {
      moveTo(getState() === "open" ? "closed" : "open");
      return;
    }

    // Un flick rápido gana sobre la posición; si no, manda el punto medio.
    if (Math.abs(velocity) > 0.5) {
      moveTo(velocity > 0 ? "closed" : "open");
      return;
    }
    const y = (gsap.getProperty(sheet, "y") as number) ?? closedY;
    moveTo(y < closedY / 2 ? "open" : "closed");
  };

  grab.addEventListener("pointerup", end);
  grab.addEventListener("pointercancel", end);
}

export function initSheet(): void {
  sheet = document.getElementById("sheet") as HTMLDivElement;
  grab = document.getElementById("sheet-grab") as HTMLDivElement;
  if (!sheet || !grab) return;

  scrim = document.getElementById("sheet-scrim") as HTMLDivElement | null;
  fab = document.getElementById("fab-report") as HTMLButtonElement | null;
  menu = document.getElementById("sheet-toggle") as HTMLButtonElement | null;
  tabs = [...grab.querySelectorAll<HTMLButtonElement>("[data-tab-btn]")];

  for (const button of tabs) {
    button.addEventListener("click", () => showTab(button.dataset.tabBtn as string));
  }

  menu?.addEventListener("click", openSheet);
  scrim?.addEventListener("click", closeSheet);
  document.getElementById("sheet-close")?.addEventListener("click", closeSheet);

  fab?.addEventListener("click", openReportPanel);
  document.getElementById("close-report")?.addEventListener("click", closeReportPanel);
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    // El formulario primero: con él abierto, Escape cierra el formulario, no
    // todo el sheet de un golpe.
    if (sheet.dataset.tab === "reportar") closeReportPanel();
    else closeSheet();
  });

  paintTabs();

  initDrag();

  // El alto del sheet cambia al abrir acordeones o al crecer la lista.
  new ResizeObserver(() => {
    if (!isMobile()) return;
    measure();
    if (getState() === "closed") gsap.set(sheet, { y: closedY });
  }).observe(sheet);

  let resizeTimer = 0;
  window.addEventListener("resize", () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(applyBreakpoint, 150);
  });
  mobile.addEventListener("change", applyBreakpoint);

  applyBreakpoint();
}
