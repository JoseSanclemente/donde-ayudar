import { MISSING_ENV_MESSAGE, supabase } from "../supabase";
import { loadCenters } from "./centers";
import { onReconnect, startLive } from "./live";
import { loadOffers } from "./offers";
import { loadPets } from "./pets";
import { loadReports, setReportsState, startRetireSweep } from "./reports";
import { ensureSession, restoreSession } from "./session";
import { loadStats } from "./stats";
import { initSync, markSynced, resyncAll } from "./sync";
import { loadUpdates } from "./updates";
import { loadVolunteers } from "./volunteers";

/**
 * Sesión anónima, carga inicial y realtime. Va una sola vez, en el boot: el
 * canal se abre después de que todos los stores registraron su tabla, y las
 * consultas no esperan a la sesión — solo a que se recupere la que ya hubiera.
 */
export async function initData(): Promise<void> {
  if (!supabase) {
    setReportsState("error", MISSING_ENV_MESSAGE);
    return;
  }
  setReportsState("loading");
  try {
    await restoreSession();

    const loaded = Promise.all([
      loadReports(),
      loadUpdates(),
      loadOffers(),
      loadCenters(),
      loadVolunteers(),
      loadPets(),
      loadStats(),
    ]);

    const session = ensureSession();
    await Promise.all([loaded, session]);
    markSynced();

    onReconnect(() => void resyncAll({ force: true }));
    startLive();
    initSync();
    startRetireSweep();
    setReportsState("ready");
  } catch {
    setReportsState(
      "error",
      "No se pudieron cargar los reportes. Revisa la conexión.",
    );
  }
}
