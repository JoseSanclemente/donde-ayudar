import { MISSING_ENV_MESSAGE, supabase } from "../supabase";
import { onReconnect, startLive } from "./live";
import { loadPets, setPetsState } from "./pets";

/**
 * El arranque de `/mascotas`: carga inicial, realtime y relectura.
 *
 * Es aparte de `data/boot.ts` y no una rama suya porque aquel importa los seis
 * stores para llamarles su `load…()`, y un import estático se lleva el módulo al
 * bundle: reusarlo acá le habría cobrado a esta página las seis tablas, sus
 * suscripciones de realtime y Leaflet de arrastre. Lo mismo vale para `sync.ts`,
 * que importa los mismos seis — la relectura de esta página son estas veinte
 * líneas.
 *
 * Tampoco hay sesión anónima: la página solo lee, y la policy de SELECT es
 * `to anon`. Registrarse le pondría a cada primera visita una ida y vuelta
 * entera por delante de la primera foto.
 */

const THROTTLE_MS = 30_000;

let lastSyncAt = 0;
let inFlight = false;

async function resync(force: boolean): Promise<void> {
  if (!supabase || inFlight) return;
  if (!force && lastSyncAt && Date.now() - lastSyncAt < THROTTLE_MS) return;
  inFlight = true;
  try {
    await loadPets();
    lastSyncAt = Date.now();
    setPetsState("ready");
  } catch {
    setPetsState(
      "error",
      "No se pudieron cargar las mascotas. Revisa la conexión.",
    );
  } finally {
    inFlight = false;
  }
}

export async function initPetsData(): Promise<void> {
  if (!supabase) {
    setPetsState("error", MISSING_ENV_MESSAGE);
    return;
  }
  setPetsState("loading");
  await resync(true);

  onReconnect(() => void resync(true));
  startLive();

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void resync(false);
  });
}
