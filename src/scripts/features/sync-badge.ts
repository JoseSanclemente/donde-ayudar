import { getSync, onSync, type SyncState } from "../data/sync";
import { $ } from "../ui/dom";
import { relativeTimeExact } from "../ui/time";

/**
 * Insignia de frescura, al lado del título.
 *
 * Un mapa de emergencia que se quedó viejo sin avisar es peor que uno que dice
 * que no pudo actualizarse. Acá se ve cuándo fue la última lectura y si hay una
 * en curso.
 *
 * Las clases van escritas literales: el escáner de Tailwind lee este archivo
 * como texto plano y un nombre de clase interpolado nunca se compila.
 */

const DOT = {
  ok: "h-1.5 w-1.5 rounded-full bg-emerald-500",
  syncing: "h-1.5 w-1.5 animate-pulse rounded-full bg-sky-500",
  failed: "h-1.5 w-1.5 rounded-full bg-red-500",
};

const BADGE =
  "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium";

const TONE = {
  ok: `${BADGE} bg-slate-100 text-slate-600`,
  syncing: `${BADGE} bg-sky-50 text-sky-700`,
  failed: `${BADGE} bg-red-50 text-red-700`,
};

export function initSyncBadge(): void {
  const badge = $<HTMLSpanElement>("sync-badge");
  const dot = $<HTMLSpanElement>("sync-dot");
  const label = $<HTMLSpanElement>("sync-label");

  // El ticker global de `ui/time` corre cada minuto: sirve para «hace 2 horas»,
  // no para un contador que arranca en segundos. Este es su propio reloj, y se
  // frena solo — cada cuarto de minuto mientras el número corre, cada minuto
  // después. Repintar cada segundo no aportaría precisión útil y dejaría un
  // temporizador despierto toda la sesión.
  const STEP_MS = 15_000;
  let timer: number | undefined;

  function stopTicking(): void {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  }

  function tick(iso: string): void {
    label.textContent = `Actualizado ${relativeTimeExact(iso)}`;
    const age = Date.now() - Date.parse(iso);
    // El siguiente repintado cae en el múltiplo exacto, no a los 15 s de este:
    // así el número va 15, 30, 45 y no arrastra el desfase del temporizador.
    timer = window.setTimeout(
      () => tick(iso),
      age < 60_000 ? STEP_MS - (age % STEP_MS) : 60_000,
    );
  }

  function render(state: SyncState): void {
    stopTicking();

    if (state.syncing) {
      badge.className = TONE.syncing;
      dot.className = DOT.syncing;
      label.textContent = "Actualizando…";
      return;
    }

    if (state.failed) {
      badge.className = TONE.failed;
      dot.className = DOT.failed;
      label.textContent = "Sin conexión";
      // Lo último que sí se sabe, para quien quiera el detalle.
      badge.title = state.lastSyncAt
        ? `Última actualización: ${new Date(state.lastSyncAt).toLocaleTimeString("es-CO")}`
        : "Todavía no se pudo cargar";
      return;
    }

    badge.className = TONE.ok;
    dot.className = DOT.ok;
    badge.removeAttribute("title");
    if (!state.lastSyncAt) {
      label.textContent = "Cargando…";
      return;
    }
    tick(state.lastSyncAt);
  }

  onSync(render);
  render(getSync());
}
