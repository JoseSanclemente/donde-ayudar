import type { Centro, CentroAcopio, Origen } from "../centros";
import { categoryItemsEnPunto, isCategoryId } from "../resources";
import { MISSING_ENV_MESSAGE, supabase } from "../supabase";
import { createEmitter } from "./emitter";
import { errorMessage, reportError } from "./errors";
import { bindTable, type RealtimePayload } from "./live";
import { getUserId } from "./session";

/**
 * Donation points — collection centers, shelters and blood banks.
 *
 * The narrowest write path of the four stores, and on purpose. There is no
 * update policy at all, so nothing here edits a point once it is published, and
 * the insert only accepts a collection center registered by the community
 * (`origen: "comunidad"`, `user_id` the current session). Shelters, blood banks
 * and every curated point stay the maintainer's, written in the Supabase table
 * editor, which runs as `service_role` and bypasses RLS.
 *
 * These used to be YAML files in `src/content/centros/`, validated on every
 * build. That was the problem: fixing a shelter's opening hours took a commit
 * and a deploy, and in an emergency that delay is the whole issue. Waiting for
 * a maintainer to publish a new collection center is the same problem one step
 * later, which is what the community insert answers.
 */
type Row = {
  id: string;
  tipo: string;
  origen: string | null;
  user_id: string | null;
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
  confirmed_at: string | null;
  activo: boolean;
};

/** Lo que el formulario deja escribir: un acopio, y solo estos campos. */
export type NuevoAcopio = {
  name: string;
  direccion: string;
  lat: number;
  lng: number;
  horario: string;
  telefono: string | null;
  notas: string | null;
  recibe: string[];
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
 * La columna guardaba ids de categoría antes de que guardara nombres de insumo.
 * La migración expandió las filas que había, pero el editor de tablas sigue
 * siendo una superficie escrita a mano: un mantenedor que escriba `salud` tiene
 * que seguir publicando lo mismo de siempre, no un chip «Otros». Lo que ya es
 * nombre de insumo pasa derecho.
 */
function expandirRecibe(recibe: unknown): string[] {
  if (!Array.isArray(recibe)) return [];
  const items = recibe
    .filter((value): value is string => typeof value === "string")
    .flatMap((value) => (isCategoryId(value) ? categoryItemsEnPunto(value) : value.trim()));
  return [...new Set(items)];
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
    // `curado` por defecto: una fila guardada antes de que existiera la columna
    // —o leída por una pestaña que no ha recargado— es de las once originales.
    origen: (row.origen === "comunidad" ? "comunidad" : "curado") as Origen,
    userId: row.user_id ?? null,
    name: row.name,
    direccion: row.direccion ?? "",
    lat: row.lat,
    lng: row.lng,
    horario: row.horario ?? "",
    telefono: text(row.telefono),
    notas: text(row.notas),
    // The column is `not null default true`; the `?? true` covers a payload from
    // an older shape, not the database.
    recibiendo: row.recibiendo ?? true,
    nota_estado: text(row.nota_estado),
    // A row from before the column existed — or a payload read by a tab that
    // has not reloaded — degrades to «just confirmed». The other way round it
    // would grey out the whole map on a shape it simply cannot see.
    confirmedAt: text(row.confirmed_at) ?? new Date().toISOString(),
  };

  // A blood bank takes no supplies, and `centros_recibe_por_tipo` guarantees it
  // in the table, so the `recibe` block never gets built for one — but it can
  // still be paused, so the rest of `base` carries over untouched.
  if (row.tipo === "sangre") return { ...base, tipo: "sangre" };

  return {
    ...base,
    tipo: row.tipo === "albergue" ? "albergue" : "acopio",
    recibe: expandirRecibe(row.recibe),
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

/* ------------------------------------------------------------------ */
/* Escritura — solo acopios de la comunidad, optimista como los reportes */
/* ------------------------------------------------------------------ */

/**
 * Publica un punto de acopio. Devuelve el centro ya en la caché: el marcador
 * aparece en el mapa antes de que el insert vuelva, y si el insert falla se
 * quita solo.
 *
 * El id es un uuid y no un slug del nombre: el CHECK de la tabla acepta
 * minúsculas, dígitos y guiones, que es exactamente lo que trae un uuid, y así
 * dos personas registrando «Colegio San José» a la vez no chocan.
 */
export function addCentro(input: NuevoAcopio): CentroAcopio {
  const centro: CentroAcopio = {
    ...input,
    id: crypto.randomUUID(),
    tipo: "acopio",
    origen: "comunidad",
    userId: getUserId() ?? "",
    telefono: input.telefono ?? undefined,
    notas: input.notas ?? undefined,
    recibiendo: true,
    confirmedAt: new Date().toISOString(),
  };
  cache = sorted([...cache, centro]);
  emit();
  void pushCentro(centro);
  return centro;
}

async function pushCentro(centro: CentroAcopio): Promise<void> {
  if (!supabase) {
    dropLocally(centro.id);
    reportError(MISSING_ENV_MESSAGE);
    return;
  }
  const userId = getUserId();
  if (!userId) {
    dropLocally(centro.id);
    reportError("Aún no hay sesión. Recarga la página e inténtalo de nuevo.");
    return;
  }

  const { data, error } = await supabase
    .from(TABLE)
    .insert({
      id: centro.id,
      tipo: "acopio",
      origen: "comunidad",
      user_id: userId,
      name: centro.name,
      direccion: centro.direccion,
      lat: centro.lat,
      lng: centro.lng,
      horario: centro.horario,
      telefono: centro.telefono ?? null,
      notas: centro.notas ?? null,
      recibe: centro.recibe,
    })
    .select()
    .single();

  if (error || !isRow(data)) {
    dropLocally(centro.id);
    reportError(
      errorMessage(
        error,
        "No se pudo registrar el punto. Revisa la conexión e inténtalo de nuevo.",
      ),
    );
    return;
  }

  cache = sorted([...cache.filter((c) => c.id !== data.id), fromRow(data)]);
  emit();
}

function dropLocally(id: string): void {
  cache = cache.filter((centro) => centro.id !== id);
  emit();
}

export function removeCentro(id: string): void {
  const previous = cache.find((centro) => centro.id === id);
  dropLocally(id);
  if (!previous) return;
  void (async () => {
    if (!supabase) return;
    const { error } = await supabase.from(TABLE).delete().eq("id", id);
    if (!error) return;
    // La policy solo deja borrar el punto propio, y ninguno curado: si falla, el
    // punto sigue vivo para todos los demás y el mapa tiene que reponerlo.
    cache = sorted([...cache, previous]);
    emit();
    reportError("Solo puedes eliminar los puntos que registraste en este navegador.");
  })();
}

/**
 * Dice que el punto sigue abierto y le corre el día de vigencia.
 *
 * Comunitario, igual que «cubierto»: quien pasa por la bodega sabe si sigue
 * abierta, y quien la registró anoche ya no está ahí —ni tiene por qué conservar
 * la sesión anónima con la que la publicó—. Vía RPC porque la tabla no tiene
 * policy de UPDATE: `confirm_centro` toca `confirmed_at` y nada más.
 */
export function confirmCentro(id: string): void {
  const previous = cache.find((centro) => centro.id === id);
  if (!previous) return;

  const now = new Date().toISOString();
  cache = cache.map((centro) => (centro.id === id ? { ...centro, confirmedAt: now } : centro));
  emit();

  void (async () => {
    if (!supabase) return;
    const { error } = await supabase.rpc("confirm_centro", { p_id: id });
    if (!error) return;
    // El punto vuelve a verse vencido: decir que alguien lo confirmó cuando el
    // servidor no se enteró es justo el error que esto viene a evitar.
    cache = cache.map((centro) =>
      centro.id === id ? { ...centro, confirmedAt: previous.confirmedAt } : centro,
    );
    emit();
    reportError(errorMessage(error, "No se pudo confirmar el punto. Revisa la conexión."));
  })();
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
