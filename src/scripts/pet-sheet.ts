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

const reduceMotion = window.matchMedia(
  "(prefers-reduced-motion: reduce)",
).matches;

const TAP_SLOP = 6;

let sheet: HTMLDivElement | null = null;
let grab: HTMLDivElement | null = null;
let body: HTMLDivElement | null = null;
let scrim: HTMLDivElement | null = null;

let closedY = 0;

function isOpen(): boolean {
  return sheet?.dataset.state === "open";
}

function lift(el: HTMLElement | null, value: string): void {
  if (el) el.style.willChange = value;
}

function drop(el: HTMLElement | null): void {
  if (el) el.style.willChange = "";
}

function measure(): void {
  if (!sheet) return;

  closedY = sheet.offsetHeight + 24;
}

function paintScrim(open: boolean, animate: boolean): void {
  if (!scrim) return;
  gsap.killTweensOf(scrim);
  if (open) {
    scrim.hidden = false;
    if (!animate || reduceMotion) {
      gsap.set(scrim, { opacity: 1 });
      drop(scrim);
      return;
    }
    lift(scrim, "opacity");
    gsap.to(scrim, {
      opacity: 1,
      duration: 0.35,
      ease: "power3.out",
      onComplete: () => drop(scrim),
    });
    return;
  }
  if (!animate || reduceMotion) {
    gsap.set(scrim, { opacity: 0 });
    scrim.hidden = true;
    drop(scrim);
    return;
  }
  lift(scrim, "opacity");
  gsap.to(scrim, {
    opacity: 0,
    duration: 0.3,
    ease: "power3.out",

    onComplete: () => {
      drop(scrim);
      if (!isOpen() && scrim) scrim.hidden = true;
    },
  });
}

function moveTo(open: boolean, animate = true, settled?: () => void): void {
  if (!sheet) return;
  sheet.dataset.state = open ? "open" : "closed";
  paintScrim(open, animate);

  if (!open) measure();
  const y = open ? 0 : closedY;
  if (!animate || reduceMotion) {
    gsap.set(sheet, { y, force3D: true });
    drop(sheet);
    settled?.();
    return;
  }
  lift(sheet, "transform");
  gsap.to(sheet, {
    y,
    duration: 0.35,
    ease: "power3.out",
    force3D: true,
    onComplete: () => {
      drop(sheet);
      if (isOpen() || !sheet) {
        settled?.();
        return;
      }
      measure();
      gsap.set(sheet, { y: closedY, force3D: true });
      settled?.();
    },
  });
}

export function openPetSheet(content: HTMLElement, settled?: () => void): void {
  if (!sheet || !body) {
    settled?.();
    return;
  }
  body.replaceChildren(content);
  body.scrollTop = 0;
  measure();
  lift(sheet, "transform");
  requestAnimationFrame(() => moveTo(true, true, settled));
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
  let pendingY = 0;
  let frame = 0;

  const flush = () => {
    frame = 0;
    if (!dragging) return;
    gsap.set(panel, { y: pendingY, force3D: true });
    if (scrim && !scrim.hidden) {
      gsap.set(scrim, { opacity: 1 - pendingY / closedY });
    }
  };

  handle.addEventListener("pointerdown", (event: PointerEvent) => {
    if ((event.target as HTMLElement).closest("button")) return;

    dragging = true;
    moved = 0;
    velocity = 0;
    startY = lastY = event.clientY;
    lastTime = event.timeStamp;
    startTranslate = pendingY = (gsap.getProperty(panel, "y") as number) ?? 0;
    handle.setPointerCapture(event.pointerId);
    gsap.killTweensOf(panel);
    lift(panel, "transform");
    if (scrim && !scrim.hidden) lift(scrim, "opacity");
  });

  handle.addEventListener("pointermove", (event: PointerEvent) => {
    if (!dragging) return;
    const last = event.getCoalescedEvents?.().at(-1) ?? event;
    const delta = last.clientY - startY;
    moved = Math.max(moved, Math.abs(delta));

    const dt = last.timeStamp - lastTime;
    if (dt > 0) velocity = (last.clientY - lastY) / dt;
    lastY = last.clientY;
    lastTime = last.timeStamp;

    pendingY = Math.min(closedY, Math.max(0, startTranslate + delta));
    frame ||= requestAnimationFrame(flush);
  });

  const end = (event: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    if (frame) {
      cancelAnimationFrame(frame);
      frame = 0;
      gsap.set(panel, { y: pendingY, force3D: true });
      if (scrim && !scrim.hidden) {
        gsap.set(scrim, { opacity: 1 - pendingY / closedY });
      }
    }
    drop(panel);
    drop(scrim);
    if (handle.hasPointerCapture(event.pointerId)) {
      handle.releasePointerCapture(event.pointerId);
    }

    if (moved < TAP_SLOP) {
      closePetSheet();
      return;
    }

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
  document
    .getElementById("pet-sheet-close")
    ?.addEventListener("click", closePetSheet);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closePetSheet();
  });

  initDrag();

  new ResizeObserver(() => {
    if (gsap.isTweening(sheet as HTMLDivElement)) return;
    measure();
    if (!isOpen()) gsap.set(sheet, { y: closedY, force3D: true });
  }).observe(sheet);

  measure();
  moveTo(false, false);
}
