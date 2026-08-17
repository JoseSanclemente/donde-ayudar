import { supabase } from "../supabase";

export type RealtimePayload = {
  eventType: string;
  new: unknown;
  old: unknown;
};

type Binding = { table: string; handler: (payload: RealtimePayload) => void };

const bindings: Binding[] = [];
const reconnects: Array<() => void> = [];
let started = false;
let wasSubscribed = false;

/**
 * Registra una tabla en el canal compartido. No abre nada: solo apunta. Cada
 * store llama esto al cargarse y `startLive()` va una sola vez en el boot.
 */
export function bindTable(
  table: string,
  handler: (payload: RealtimePayload) => void,
): void {
  bindings.push({ table, handler });
}

/**
 * Avisa cuando el canal vuelve después de haberse caído. No importa nada de
 * `data/` acá: los stores importan este módulo, así que llamarlos desde acá
 * sería un ciclo. El arranque es el que conecta esta señal con la relectura.
 */
export function onReconnect(cb: () => void): void {
  reconnects.push(cb);
}

/**
 * Un solo canal para todas las tablas. Lo que cuenta contra el límite de
 * conexiones de Supabase es el canal, no cuántos `postgres_changes` lleve
 * dentro: tres canales por visitante triplicarían los joins sin ganar nada.
 */
export function startLive(): void {
  if (!supabase || started) return;
  started = true;
  let channel = supabase.channel("publico");
  for (const { table, handler } of bindings) {
    channel = channel.on(
      "postgres_changes",
      { event: "*", schema: "public", table },
      handler as never,
    );
  }
  channel.subscribe((status) => {
    if (status !== "SUBSCRIBED") return;

    if (wasSubscribed) for (const cb of reconnects) cb();
    wasSubscribed = true;
  });
}
