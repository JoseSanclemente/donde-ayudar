import gsap from "gsap";
import { getDepartmentCut, getNationalCut, onStats } from "../data/stats";
import { formatFigure, readFigures, type Snapshot } from "../stats";
import { isMobile } from "../ui/breakpoint";
import { $, scheduleRender } from "../ui/dom";
import { escapeHtml } from "../ui/html";
import { absoluteTime } from "../ui/time";

/**
 * Las cifras de la emergencia: la tarjeta que baja del header al alejar el mapa.
 *
 * Devuelve sus verbos en vez de escuchar los botones, porque los botones son de
 * otras features y una feature no importa otra: `app.ts` las une, igual que
 * `pets.ts` le pasa el `setFilter` de la grilla al filtro. La saca «ver toda la
 * emergencia»; la quitan la ✕ y «centrar en mí».
 *
 * Los números suben desde cero. No es adorno: son la respuesta a un gesto
 * —alejarse hasta que cabe todo— y contar es lo que hace que el gesto y la cifra
 * se lean como una sola cosa. Quien pidió menos movimiento los ve puestos de una.
 */
const reduceMotion = window.matchMedia(
  "(prefers-reduced-motion: reduce)",
).matches;

const COUNT_SECONDS = 1.1;

const SLIDE_IN_SECONDS = 0.45;

/**
 * La subida de vuelta, más corta que la bajada. Entrar es una respuesta y se
 * mira; salir es un trámite y estorba — y acá estorba de verdad, porque «centrar
 * en mí» también la cierra y detrás viene un vuelo del mapa.
 */
const SLIDE_OUT_SECONDS = 0.28;

/**
 * El aire entre el header y la tarjeta, en píxeles — las `0.5rem` de la regla de
 * `#emergency-stats` en `global.css`. Se suma a la altura para calcular hasta
 * dónde sube: con solo la altura, el borde de arriba queda justo en el del
 * header y el último frame la deja asomada.
 */
const SLIDE_GAP = 8;

/**
 * Debajo del header (900) mientras se mueve, para que el viaje quede tapado.
 *
 * En reposo la tarjeta va en 1060, encima de los botones flotantes, que están en
 * 1050: quieta tiene que ganarles. Pero entrando y saliendo tiene que perder
 * contra el header, o no saldría de atrás de él sino por encima. Son dos
 * respuestas a dos momentos distintos, y por eso el z-index se anima con el
 * resto.
 */
const SLIDE_Z = 880;

/**
 * El aire entre el borde de abajo de la tarjeta y el pin más al norte, para que
 * no queden pegados.
 */
const RESERVE_AIR = 12;

function travel(card: HTMLElement): number {
  return -(card.offsetHeight + SLIDE_GAP);
}

/**
 * Entra deslizándose desde atrás del header, y solo en móvil.
 *
 * Ahí el header flota sobre el mapa, así que mientras la tarjeta sube por detrás
 * queda tapada de verdad: la animación no simula salir del header, sale. En
 * escritorio no hay de dónde salir —la tarjeta es la primera de la columna, en
 * el flujo, debajo de un header que no flota— y una bajada ahí sería un adorno
 * sin causa.
 */
function slideIn(card: HTMLElement): void {
  gsap.killTweensOf(card);
  if (reduceMotion || !isMobile()) {
    gsap.set(card, { clearProps: "transform,opacity,zIndex" });
    return;
  }
  gsap.fromTo(
    card,
    { y: travel(card), opacity: 0, zIndex: SLIDE_Z },
    {
      y: 0,
      opacity: 1,
      duration: SLIDE_IN_SECONDS,
      ease: "power3.out",

      clearProps: "transform,opacity,zIndex",
    },
  );
}

/**
 * Se va por donde vino: de vuelta detrás del header.
 *
 * El `hidden` se pone al final y no al principio — un elemento escondido no se
 * anima—, así que hasta que termina la tarjeta sigue ahí. `killTweensOf` al
 * entrar es lo que evita que dos cierres seguidos, o un cierre encima de una
 * apertura, se peleen por el mismo `transform`.
 */
function slideOut(card: HTMLElement, done: () => void): void {
  gsap.killTweensOf(card);
  if (reduceMotion || !isMobile() || card.hidden) {
    gsap.set(card, { clearProps: "transform,opacity,zIndex" });
    done();
    return;
  }
  gsap.to(card, {
    y: travel(card),
    opacity: 0,
    zIndex: SLIDE_Z,
    duration: SLIDE_OUT_SECONDS,
    ease: "power3.in",
    onComplete: () => {
      done();
      gsap.set(card, { clearProps: "transform,opacity,zIndex" });
    },
  });
}

/**
 * Una cifra: la etiqueta debajo del número en las grandes, al lado en el resto.
 *
 * El texto sale ya con su valor final y no en cero. Es lo que arregla que las
 * cifras se cayeran a cero solas: el store vuelve a emitir cuando llega un
 * evento de realtime o cuando `sync` relee al volver a la pestaña, y cada
 * emisión rearma este HTML. Naciendo en cero, ese repintado dejaba la tarjeta
 * abierta llena de ceros sin nadie que los animara de vuelta. El cero es cosa de
 * `countUp`, que lo escribe en el primer frame de la cuenta y lo llena enseguida.
 */
function figureHtml(label: string, value: number, headline: boolean): string {
  const text = formatFigure(value);
  if (headline)
    return `
      <div>
        <dd data-count="${value}" class="text-2xl font-semibold leading-none tabular-nums text-slate-900">${text}</dd>
        <dt class="mt-1 text-xs leading-tight text-slate-500">${escapeHtml(label)}</dt>
      </div>`;
  return `
    <div class="flex items-baseline justify-between gap-3">
      <dt class="text-xs text-slate-600">${escapeHtml(label)}</dt>
      <dd data-count="${value}" class="text-xs font-semibold tabular-nums text-slate-900">${text}</dd>
    </div>`;
}

function cutLine(snapshot: Snapshot): string {
  return `Corte: ${absoluteTime(snapshot.cutAt)}`;
}

function render(): void {
  const card = $("emergency-stats");
  const national = getNationalCut();

  if (!national) {
    card.dataset.ready = "";
    return;
  }
  card.dataset.ready = "true";

  $("emergency-stats-headline").innerHTML = readFigures(national, "headline")
    .map(({ label, value }) => figureHtml(label, value, true))
    .join("");
  $("emergency-stats-rest").innerHTML = readFigures(national, "rest")
    .map(({ label, value }) => figureHtml(label, value, false))
    .join("");
  $("emergency-stats-cut").textContent = cutLine(national);

  const departmental = getDepartmentCut();
  const block = $("emergency-stats-departmental");
  block.hidden = !departmental;
  if (departmental) {
    $("emergency-stats-departments").innerHTML = readFigures(
      departmental,
      "departmental",
    )
      .map(({ label, value }) => figureHtml(label, value, false))
      .join("");
    $("emergency-stats-departmental-cut").textContent = cutLine(departmental);
  }

  const source = $("emergency-stats-source");
  source.innerHTML = national.sourceUrl
    ? `Fuente: <a class="underline" href="${escapeHtml(national.sourceUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(national.source)}</a>`
    : `Fuente: ${escapeHtml(national.source)}`;
}

/**
 * Mide cuánto va a tapar la tarjeta, **sin mostrarla**.
 *
 * El vuelo necesita el número antes de arrancar —es el relleno que baja los
 * pines— y la tarjeta no aparece hasta que el vuelo aterriza. Escondida con
 * `hidden` no se puede medir: `display: none` no tiene rectángulo.
 *
 * Así que se destapa con `visibility: hidden`, que sí ocupa su lugar, se mide y
 * se vuelve a tapar. Las tres cosas en el mismo tick, sin ceder el hilo, así que
 * no hay frame intermedio y nunca se pinta. Cuesta un cálculo de layout forzado,
 * una vez por toque.
 *
 * Se midió mostrándola de verdad y era peor: para poder medirla había que sacarla
 * antes del vuelo, y ahí se quedaba un segundo largo con los números en cero
 * esperando a que el mapa terminara de moverse.
 */
function measure(card: HTMLElement): number {
  if (!isMobile()) return 0;
  card.style.visibility = "hidden";
  card.hidden = false;

  const bottom = card.getBoundingClientRect().bottom;
  card.hidden = true;
  card.style.visibility = "";
  return bottom + RESERVE_AIR;
}

/**
 * Cuenta desde cero hasta el valor que ya está escrito.
 *
 * Solo lo visible: un `<dd>` dentro del detalle plegado tiene el número puesto y
 * animarlo no lo vería nadie — y peor, al desplegar aparecería a mitad de camino.
 */
function countUp(card: HTMLElement): void {
  for (const el of card.querySelectorAll<HTMLElement>("[data-count]")) {
    const target = Number(el.dataset.count);
    if (!Number.isFinite(target)) continue;
    gsap.killTweensOf(el);
    if (reduceMotion || el.offsetParent === null) {
      el.textContent = formatFigure(target);
      continue;
    }
    const counter = { n: 0 };
    gsap.to(counter, {
      n: target,
      duration: COUNT_SECONDS,
      ease: "power2.out",
      onUpdate: () => {
        el.textContent = formatFigure(counter.n);
      },

      onComplete: () => {
        el.textContent = formatFigure(target);
      },
    });
  }
}

export type EmergencyStats = {
  /**
   * Cuánto va a tapar la tarjeta desde arriba del mapa, medido sin mostrarla.
   * Antes del vuelo, que lo usa de relleno. En escritorio, nada.
   */
  reservedTop: () => number;

  show: () => void;
  hide: () => void;
};

export function initEmergencyStats(): EmergencyStats {
  const card = $("emergency-stats");
  const details = $("emergency-stats-details");
  const toggle = $<HTMLButtonElement>("emergency-stats-toggle");
  const caret = $("emergency-stats-caret");

  const paint = scheduleRender(render);
  render();
  onStats(paint);

  const hide = () => {
    slideOut(card, () => {
      card.hidden = true;
    });
  };

  const fold = (open: boolean) => {
    details.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
    caret.style.transform = open ? "rotate(180deg)" : "";
  };

  toggle.addEventListener("click", () => fold(Boolean(details.hidden)));

  $("emergency-stats-close").addEventListener("click", hide);

  return {
    reservedTop: () => {
      if (card.dataset.ready !== "true") return 0;
      fold(false);
      return measure(card);
    },
    show: () => {
      if (card.dataset.ready !== "true") return;
      fold(false);
      card.hidden = false;

      slideIn(card);
      countUp(card);
    },
    hide,
  };
}
