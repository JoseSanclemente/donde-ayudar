import { supabase } from "../supabase";

export type RealtimePayload = {
  eventType: string;
  new: unknown;
  old: unknown;
};

type Binding = { table: string; handler: (payload: RealtimePayload) => void };

const bindings: Binding[] = [];
let started = false;

/**
 * Registra una tabla en el canal compartido. No abre nada: solo apunta. Cada
 * store llama esto al cargarse y `startLive()` va una sola vez en el boot.
 */
export function bindTable(table: string, handler: (payload: RealtimePayload) => void): void {
  bindings.push({ table, handler });
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
  channel.subscribe();
}
