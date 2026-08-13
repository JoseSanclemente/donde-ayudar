export function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diffMs / 60000);
  const formatter = new Intl.RelativeTimeFormat("es-CO", { numeric: "auto" });
  if (Math.abs(minutes) < 60) return formatter.format(-minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return formatter.format(-hours, "hour");
  return formatter.format(-Math.round(hours / 24), "day");
}

/**
 * Igual que `relativeTime`, pero con segundos en el primer minuto.
 *
 * `relativeTime` redondea a minutos y devuelve «este minuto», que para un
 * reporte de hace rato está bien y para un contador de frescura no: quien mira
 * la insignia después de recargar quiere ver que el número corre. Se acota a un
 * segundo hacia abajo — «hace 0 segundos» se lee como un error.
 */
export function relativeTimeExact(iso: string): string {
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) {
    const formatter = new Intl.RelativeTimeFormat("es-CO", { numeric: "always" });
    return formatter.format(-Math.max(seconds, 1), "second");
  }
  return relativeTime(iso);
}

/**
 * A partir de acá el dato deja de ser confiable. Seis horas es una guardia
 * completa: en una emergencia el sitio ya cambió de manos, de necesidades y a
 * veces de estado sin que nadie lo haya tocado en la página.
 */
export const STALE_HOURS = 6;

export function hoursSince(iso: string): number {
  return (Date.now() - new Date(iso).getTime()) / 3_600_000;
}

export function isStale(iso: string): boolean {
  return hoursSince(iso) >= STALE_HOURS;
}

/**
 * Cuánto dura «recién llegado». Una hora es lo que separa lo que pasó mientras
 * alguien tenía la página abierta de lo que ya estaba cuando llegó.
 */
export const FRESH_HOURS = 1;

export function isFresh(iso: string): boolean {
  return hoursSince(iso) < FRESH_HOURS;
}

/** La más reciente de varias fechas ISO. Ignora las vacías. */
export function newestIso(...dates: Array<string | null | undefined>): string {
  let best = "";
  for (const date of dates) {
    if (!date) continue;
    if (!best || Date.parse(date) > Date.parse(best)) best = date;
  }
  return best;
}

/**
 * Repinta los `[data-time]` cada minuto sin rearmar la lista. Un «hace 2
 * minutos» que se queda congelado media hora es peor que no mostrar nada: dice
 * que el dato está fresco cuando ya no lo está.
 *
 * En la misma pasada apaga los `[data-fresh]`, los avisos de «recién llegado»:
 * son el mismo reloj, y sin esto un punto se quedaría encendido toda la tarde
 * en una pestaña que nadie volvió a tocar.
 */
export function startTimeTicker(): void {
  setInterval(() => {
    for (const el of document.querySelectorAll<HTMLElement>("[data-time]")) {
      const iso = el.dataset.time;
      if (!iso) continue;
      const prefix = el.dataset.timePrefix ?? "";
      el.textContent = `${prefix}${relativeTime(iso)}`;
    }
    for (const el of document.querySelectorAll<HTMLElement>("[data-fresh]")) {
      const iso = el.dataset.fresh;
      if (!iso) continue;
      el.hidden = !isFresh(iso);
    }
  }, 60_000);
}

/** Escribe la fecha en el elemento y lo deja marcado para el ticker. */
export function paintTime(el: HTMLElement, iso: string, prefix = ""): void {
  el.dataset.time = iso;
  if (prefix) el.dataset.timePrefix = prefix;
  el.textContent = `${prefix}${relativeTime(iso)}`;
}
