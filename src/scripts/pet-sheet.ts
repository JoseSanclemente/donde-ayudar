import gsap from "gsap";

/**
 * El panel de abajo de `/mascotas`: la foto grande y el botón de WhatsApp de la
 * mascota que se tocó.
 *
 * Es el gemelo visual de `sheet.ts` —el mismo tween, el mismo arrastre, el mismo
 * scrim— sin nada de lo que ata aquel al mapa: no tiene pestañas, no tiene el
 * estado `peek` y no se apaga en escritorio. `sheet.ts` importa `./map` y en
 * `lg` se vuelve `display: contents` porque allá sus paneles son la barra
 * lateral; esta página no tiene ni mapa ni barra lateral, así que el panel es un
 * panel en todos los anchos —centrado y angosto en pantalla grande— y este
 * módulo no depende de nada más que del DOM.
 */

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Un arrastre más corto que esto cuenta como tap, igual que en el otro sheet. */
const TAP_SLOP = 6;

let sheet: HTMLDivElement | null = null;
let grab: HTMLDivElement | null = null;
let body: HTMLDivElement | null = null;
let scrim: HTMLDivElement | null = null;
/** Desplazamiento que deja el panel completamente fuera de la pantalla. */
let closedY = 0;

function isOpen(): boolean {
  return sheet?.dataset.state === "open";
}

function measure(): void {
  if (!sheet) return;
  // El extra cubre la sombra, que si no asoma por abajo.
  closedY = sheet.offsetHeight + 24;
}

function paintScrim(open: boolean, animate: boolean): void {
  if (!scrim) return;
  gsap.killTweensOf(scrim);
  if (open) {
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
    // Esconderlo antes de que termine el fundido lo dejaría parpadeando; y si
    // mientras tanto se volvió a abrir, no hay que tocarlo.
    onComplete: () => {
      if (!isOpen() && scrim) scrim.hidden = true;
    },
  });
}

function moveTo(open: boolean, animate = true): void {
  if (!sheet) return;
  sheet.dataset.state = open ? "open" : "closed";
  paintScrim(open, animate);
  // Al cerrar manda el alto: si el contenido cambió, el `closedY` de la última
  // medición se queda corto y el panel no sale del todo.
  if (!open) measure();
  const y = open ? 0 : closedY;
  if (!animate || reduceMotion) {
    gsap.set(sheet, { y });
    return;
  }
  gsap.to(sheet, {
    y,
    duration: 0.35,
    ease: "power3.out",
    onComplete: () => {
      if (isOpen() || !sheet) return;
      measure();
      gsap.set(sheet, { y: closedY });
    },
  });
}

/** Cambia el contenido y sube el panel. La foto anterior se suelta acá. */
export function openPetSheet(content: HTMLElement): void {
  if (!sheet || !body) return;
  body.replaceChildren(content);
  body.scrollTop = 0;
  measure();
  moveTo(true);
}

export function closePetSheet(): void {
  if (!isOpen()) return;
  moveTo(false);
}

function initDrag(): void {
  if (!grab || !sheet) return;
  const handle = grab;
  const panel = sheet;

  let startY = 0;
  let startTranslate = 0;
  let lastY = 0;
  let lastTime = 0;
  let velocity = 0;
  let dragging = false;
  let moved = 0;

  handle.addEventListener("pointerdown", (event: PointerEvent) => {
    // La ✕ se maneja con su propio click.
    if ((event.target as HTMLElement).closest("button")) return;

    dragging = true;
    moved = 0;
    velocity = 0;
    startY = lastY = event.clientY;
    lastTime = event.timeStamp;
    startTranslate = (gsap.getProperty(panel, "y") as number) ?? 0;
    handle.setPointerCapture(event.pointerId);
    gsap.killTweensOf(panel);
  });

  handle.addEventListener("pointermove", (event: PointerEvent) => {
    if (!dragging) return;
    const delta = event.clientY - startY;
    moved = Math.max(moved, Math.abs(delta));

    const dt = event.timeStamp - lastTime;
    if (dt > 0) velocity = (event.clientY - lastY) / dt; // px/ms, + hacia abajo
    lastY = event.clientY;
    lastTime = event.timeStamp;

    const y = Math.min(closedY, Math.max(0, startTranslate + delta));
    gsap.set(panel, { y });
    // El scrim sigue al dedo: si no, el arrastre no se sentiría como si
    // estuviera cerrando algo.
    if (scrim && !scrim.hidden) gsap.set(scrim, { opacity: 1 - y / closedY });
  });

  const end = (event: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    if (handle.hasPointerCapture(event.pointerId)) {
      handle.releasePointerCapture(event.pointerId);
    }

    // Tap en el asa: cierra, igual que la ✕.
    if (moved < TAP_SLOP) {
      closePetSheet();
      return;
    }

    // Un flick rápido gana sobre la posición; si no, manda la mitad.
    if (Math.abs(velocity) > 0.5) {
      moveTo(velocity < 0);
      return;
    }
    const y = (gsap.getProperty(panel, "y") as number) ?? closedY;
    moveTo(y < closedY / 2);
  };

  handle.addEventListener("pointerup", end);
  handle.addEventListener("pointercancel", end);
}

export function initPetSheet(): void {
  sheet = document.getElementById("pet-sheet") as HTMLDivElement | null;
  grab = document.getElementById("pet-sheet-grab") as HTMLDivElement | null;
  if (!sheet || !grab) return;

  body = document.getElementById("pet-sheet-body") as HTMLDivElement | null;
  scrim = document.getElementById("pet-sheet-scrim") as HTMLDivElement | null;

  scrim?.addEventListener("click", closePetSheet);
  document.getElementById("pet-sheet-close")?.addEventListener("click", closePetSheet);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closePetSheet();
  });

  initDrag();

  // El alto cambia con la foto de cada mascota, que llega después de abrir.
  new ResizeObserver(() => {
    if (gsap.isTweening(sheet as HTMLDivElement)) return;
    measure();
    if (!isOpen()) gsap.set(sheet, { y: closedY });
  }).observe(sheet);

  measure();
  moveTo(false, false);
}
