import type { Centro } from "../centros";
import { supabase } from "../supabase";
import { createEmitter } from "./emitter";
import { bindTable, type RealtimePayload } from "./live";

/**
 * Curated points — collection centers, shelters and blood banks. Read only.
 *
 * The one store with no write path: the table has no insert, update or delete
 * policy, so a visitor cannot publish a point by accident or on purpose. The
 * people who keep the list edit it in the Supabase table editor, which runs as
 * `service_role` and bypasses RLS.
 *
 * These used to be YAML files in `src/content/centros/`, validated on every
 * build. That was the problem: fixing a shelter's opening hours took a commit
 * and a deploy, and in an emergency that delay is the whole issue.
 */
type Row = {
  id: string;
  tipo: string;
  name: string;
  direccion: string;
  lat: number;
  lng: number;
  horario: string;
  telefono: string | null;
  notas: string | null;
  recibe: string[] | null;
  recibiendo: boolean | null;
  nota_estado: string | null;
  activo: boolean;
};

const TABLE = "centros";

let cache: Centro[] = [];
const changes = createEmitter<Centro[]>();

function emit(): void {
  changes.emit(cache);
}

/** The domain type uses `?: string`, not `| null`: an empty column is dropped. */
function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

/**
 * Only the columns without which the point cannot be drawn at all. A new column
 * has to degrade, never invalidate the row: a browser that has not reloaded
 * since the previous deploy keeps reading this same table.
 */
function isRow(value: unknown): value is Row {
  const r = value as Row;
  return (
    !!r &&
    typeof r.id === "string" &&
    (r.tipo === "acopio" || r.tipo === "albergue" || r.tipo === "sangre") &&
    typeof r.name === "string" &&
    typeof r.lat === "number" &&
    typeof r.lng === "number"
  );
}

function fromRow(row: Row): Centro {
  const base = {
    id: row.id,
    name: row.name,
    direccion: row.direccion ?? "",
    lat: row.lat,
    lng: row.lng,
    horario: row.horario ?? "",
    telefono: text(row.telefono),
    notas: text(row.notas),
  };

  // A blood bank takes no supplies, and `centros_recibe_por_tipo` guarantees it
  // in the table, so the block never gets built for one.
  if (row.tipo === "sangre") return { ...base, tipo: "sangre" };

  return {
    ...base,
    tipo: row.tipo === "albergue" ? "albergue" : "acopio",
    recibe: Array.isArray(row.recibe) ? row.recibe : [],
    // The column is `not null default true`; the `?? true` covers a payload from
    // an older shape, not the database.
    recibiendo: row.recibiendo ?? true,
    nota_estado: text(row.nota_estado),
  };
}

/** Alphabetical. The map ignores the order, but it keeps the cache stable. */
function sorted(list: Centro[]): Centro[] {
  return [...list].sort((a, b) => a.name.localeCompare(b.name, "es"));
}

export function getCentros(): Centro[] {
  return cache;
}

export const onCentros = changes.on;

export async function loadCentros(): Promise<void> {
  if (!supabase) return;
  const { data, error } = await supabase.from(TABLE).select("*").eq("activo", true);
  if (error) throw error;
  cache = sorted((data ?? []).filter(isRow).map(fromRow));
  emit();
}

function applyRealtime(payload: RealtimePayload): void {
  if (payload.eventType === "DELETE") {
    const id = (payload.old as { id?: string } | null)?.id;
    if (!id) return;
    cache = cache.filter((centro) => centro.id !== id);
    emit();
    return;
  }

  if (!isRow(payload.new)) return;
  // Realtime sends the row regardless of the query filter, so closing a point
  // (`activo: false`) arrives here as a plain UPDATE. Without this branch a
  // straight upsert would put it back on the map right after it was closed.
  const centro = fromRow(payload.new);
  const rest = cache.filter((c) => c.id !== centro.id);
  cache = payload.new.activo === false ? rest : sorted([...rest, centro]);
  emit();
}

bindTable(TABLE, applyRealtime);
