import { MISSING_ENV_MESSAGE, supabase } from "../supabase";
import { loadCentros } from "./centros";
import { onReconnect, startLive } from "./live";
import { loadOffers } from "./offers";
import { loadReports, setReportsState } from "./reports";
import { initSession } from "./session";
import { initSync, markSynced, resyncAll } from "./sync";
import { loadUpdates } from "./updates";

/**
 * Sesión anónima, carga inicial y realtime. Va una sola vez, en el boot: el
 * canal se abre después de que todos los stores registraron su tabla.
 */
export async function initData(): Promise<void> {
  if (!supabase) {
    setReportsState("error", MISSING_ENV_MESSAGE);
    return;
  }
  setReportsState("loading");
  try {
    await initSession();
    // En paralelo: son consultas independientes y la página no puede quedarse
    // esperando la bitácora para dibujar el mapa.
    await Promise.all([loadReports(), loadUpdates(), loadOffers(), loadCentros()]);
    markSynced();
    // Antes de `startLive()`: el canal se suscribe de inmediato.
    onReconnect(() => void resyncAll({ force: true }));
    startLive();
    initSync();
    setReportsState("ready");
  } catch {
    setReportsState("error", "No se pudieron cargar los reportes. Revisa la conexión.");
  }
}
