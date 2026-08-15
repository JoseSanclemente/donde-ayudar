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
    // La sesión que ya existe se recupera primero, y no cuesta red: deja el
    // `uid` puesto antes de la primera fila, que es lo que `isMine()` necesita
    // para que quien vuelve vea suyo lo suyo desde el primer pintado.
    await restoreSession();

    // Todas las consultas y el registro anónimo van juntos, no en fila. Las
    // policies de SELECT son `to anon` —todo el mundo ve todo—, así que ninguna
    // lectura necesita sesión, y esperar el `signInAnonymously()` le ponía a
    // cada primera visita una ida y vuelta entera por delante de la primera
    // fila que se dibuja. El orden de las dos líneas importa: pedir los datos
    // antes deja los `fetch` emitidos ya; al revés, el candado de auth que toma
    // el registro los volvería a poner en fila.
    const loaded = Promise.all([
      loadReports(),
      loadUpdates(),
      loadOffers(),
      loadCenters(),
      loadVolunteers(),
      loadPets(),
      loadStats(),
    ]);
    // Sigue siendo obligatoria antes de `ready`: sin `uid` no se puede escribir
    // nada, y quien entra por primera vez no tiene todavía nada propio que el
    // pintado pueda equivocar mientras llega.
    const session = ensureSession();
    await Promise.all([loaded, session]);
    markSynced();
    // Antes de `startLive()`: el canal se suscribe de inmediato.
    onReconnect(() => void resyncAll({ force: true }));
    startLive();
    initSync();
    startRetireSweep();
    setReportsState("ready");
  } catch {
    setReportsState("error", "No se pudieron cargar los reportes. Revisa la conexión.");
  }
}
