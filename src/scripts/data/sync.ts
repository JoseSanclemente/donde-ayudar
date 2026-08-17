import { supabase } from "../supabase";
import { loadCenters } from "./centers";
import { createEmitter } from "./emitter";
import { reportError } from "./errors";
import { loadOffers } from "./offers";
import { loadPets } from "./pets";
import { loadReports } from "./reports";
import { loadStats } from "./stats";
import { loadUpdates } from "./updates";
import { loadVolunteers } from "./volunteers";

/**
 * Frescura del dato: cuándo se leyó la base por última vez y si hay una lectura
 * en curso.
 *
 * Realtime no reenvía lo que pasó mientras el socket estuvo caído, así que un
 * celular que durmió veinte minutos vuelve con un mapa que *parece* vivo. Este
 * módulo es el que lo desmiente: relee todas las tablas cuando el canal se
 * reconecta o cuando la pestaña vuelve al frente, y publica el estado para que
 * la insignia del encabezado lo muestre.
 */
export type SyncState = {
  lastSyncAt: string | null;
  syncing: boolean;

  failed: boolean;
};

const THROTTLE_MS = 30_000;

let state: SyncState = { lastSyncAt: null, syncing: false, failed: false };
let inFlight = false;

const changes = createEmitter<SyncState>();

function emit(): void {
  changes.emit(state);
}

export function getSync(): SyncState {
  return state;
}

export const onSync = changes.on;

export function markSynced(): void {
  state = {
    lastSyncAt: new Date().toISOString(),
    syncing: false,
    failed: false,
  };
  emit();
}

/**
 * Relee todas las tablas. `force` se salta el throttle — lo usa la reconexión,
 * donde el hueco puede ser de segundos pero igual se perdieron eventos.
 *
 * A propósito no toca `setReportsState("loading")`: la caché ya está pintada y
 * convertir la lista en esqueleto cada vez que alguien vuelve a la pestaña sería
 * peor que el problema. El estado de carga lo lleva la insignia.
 */
export async function resyncAll(
  options: { force?: boolean } = {},
): Promise<void> {
  if (!supabase || inFlight) return;
  if (
    !options.force &&
    state.lastSyncAt &&
    Date.now() - Date.parse(state.lastSyncAt) < THROTTLE_MS
  ) {
    return;
  }

  inFlight = true;
  state = { ...state, syncing: true };
  emit();

  try {
    await Promise.all([
      loadReports(),
      loadUpdates(),
      loadOffers(),
      loadCenters(),
      loadVolunteers(),
      loadPets(),
      loadStats(),
    ]);
    state = {
      lastSyncAt: new Date().toISOString(),
      syncing: false,
      failed: false,
    };
    emit();
  } catch {
    state = { ...state, syncing: false, failed: true };
    emit();
    reportError("No se pudo actualizar. Revisa la conexión.");
  } finally {
    inFlight = false;
  }
}

export function initSync(): void {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void resyncAll();
  });
}
