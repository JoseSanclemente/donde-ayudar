import { hasDepartmental, type Snapshot } from "../stats";
import { supabase } from "../supabase";
import { createEmitter } from "./emitter";
import { bindTable, type RealtimePayload } from "./live";

/**
 * Stats — los balances de la emergencia, un corte por fila.
 *
 * La única tienda de solo lectura del proyecto: la tabla no tiene policy de
 * insert, ni de update, ni de delete, así que acá no hay nada que empujar.
 * Escribe un mantenedor con SQL y llega por realtime, que es justo por lo que
 * esto es una tabla y no un JSON en `public/`: la UNGRD publicó un balance nuevo
 * cada día de la semana, y corregir un número no puede pedir un deploy.
 *
 * Se guardan los últimos cortes y no solo el más nuevo, porque la tarjeta arma
 * dos bloques con fechas distintas: el total nacional sale del corte más
 * reciente y el desglose por departamento del más reciente que lo traiga, que no
 * es el mismo. Nunca se mezclan en un solo número — cada bloque muestra el suyo.
 */
type Row = {
  id: string;
  source: string;
  source_url: string | null;
  cut_at: string;
  figures: unknown;
  created_at: string | null;
};

const TABLE = "stats";

/**
 * Cuántos cortes se traen. Con uno no alcanza —el desglose puede estar dos
 * balances atrás— y traerlos todos crece sin techo: la tabla gana una fila al
 * día y nadie va a mirar el balance del mes pasado desde el mapa.
 */
const RECENT_CUTS = 10;

let cache: Snapshot[] = [];
const changes = createEmitter<Snapshot[]>();

function emit(): void {
  changes.emit(cache);
}

/**
 * Solo lo que se puede pintar. `figures` viene de `jsonb`, así que llega como lo
 * que sea que haya en la fila: se filtra a números y se descarta el resto, que
 * es lo mismo que hace `isRow` en `data/centers.ts` con una columna que no
 * entiende.
 */
function isRow(value: unknown): value is Row {
  const r = value as Row;
  return (
    !!r &&
    typeof r.id === "string" &&
    typeof r.source === "string" &&
    typeof r.cut_at === "string" &&
    !!r.figures &&
    typeof r.figures === "object" &&
    !Array.isArray(r.figures)
  );
}

function numbers(figures: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(figures as Record<string, unknown>))
    if (typeof value === "number" && Number.isFinite(value)) out[key] = value;
  return out;
}

function fromRow(row: Row): Snapshot {
  return {
    id: row.id,
    source: row.source,
    sourceUrl: row.source_url ?? undefined,
    cutAt: row.cut_at,
    figures: numbers(row.figures),
  };
}

/** Del más nuevo al más viejo. El orden es el que la tarjeta da por hecho. */
function sorted(list: Snapshot[]): Snapshot[] {
  return [...list].sort((a, b) => b.cutAt.localeCompare(a.cutAt));
}

export const onStats = changes.on;

/** El balance más reciente, o `null` si todavía no llegó ninguno. */
export function getNationalCut(): Snapshot | null {
  return cache[0] ?? null;
}

/**
 * El corte más reciente que trae desglose por departamento, que casi nunca es el
 * mismo del total: el balance del 15 de agosto no lo publicó y el del 13 sí.
 */
export function getDepartmentCut(): Snapshot | null {
  return cache.find(hasDepartmental) ?? null;
}

export async function loadStats(): Promise<void> {
  if (!supabase) return;
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .order("cut_at", { ascending: false })
    .limit(RECENT_CUTS);
  if (error) throw error;
  cache = sorted((data ?? []).filter(isRow).map(fromRow));
  emit();
}

function applyRealtime(payload: RealtimePayload): void {
  if (payload.eventType === "DELETE") {
    const id = (payload.old as { id?: string } | null)?.id;
    if (!id) return;
    cache = cache.filter((snapshot) => snapshot.id !== id);
    emit();
    return;
  }

  if (!isRow(payload.new)) return;
  const snapshot = fromRow(payload.new);
  cache = sorted([...cache.filter((s) => s.id !== snapshot.id), snapshot]).slice(
    0,
    RECENT_CUTS,
  );
  emit();
}

bindTable(TABLE, applyRealtime);
