import { MISSING_ENV_MESSAGE, supabase } from "../supabase";
import { createEmitter } from "./emitter";
import { errorMessage, reportError } from "./errors";
import { bindTable, type RealtimePayload } from "./live";
import { getUserId } from "./session";
import { isRetired, isStatus, type ReportStatus } from "../status";

export type Report = {
  id: string;
  /** La dirección: es lo que lleva a alguien hasta el punto. */
  name: string;
  /** Cómo se llama el sitio: «Conjunto Los Alcázares». Opcional. */
  placeName: string | null;
  lat: number;
  lng: number;
  resources: string[];
  /** Subconjunto de `resources` que la zona ya no necesita. */
  covered: string[];
  /** Condición del sitio. Comunitaria: la cambia cualquiera, vía RPC. */
  status: ReportStatus;
  /** Cuándo se tocó el estado — la mitad de «actualizado hace X». */
  statusAt: string;
  /** Lo que no cabe en el catálogo: «NO más agua, sí bebidas hidratantes». */
  note: string | null;
  /** Contacto público y opcional, para confirmar antes de desplazarse. */
  contactName: string | null;
  contactPhone: string | null;
  createdAt: string;
  /** Dueño del reporte. Solo él puede borrarlo (policy de RLS). */
  userId: string;
};

/** Fila tal como viaja por la red — snake_case, como la tabla. */
type Row = {
  id: string;
  user_id: string;
  name: string;
  place_name: string | null;
  lat: number;
  lng: number;
  resources: string[];
  covered: string[] | null;
  status: string | null;
  status_at: string | null;
  note: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  created_at: string;
};

/** Cadena no vacía, o `null`. Las columnas opcionales llegan de las dos formas. */
function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

export type StoreState = "loading" | "ready" | "error";

const TABLE = "reports";

/* ------------------------------------------------------------------ */
/* Estado                                                              */
/* ------------------------------------------------------------------ */

// Caché en memoria: es la única fuente que lee la UI, así que `getReports()`
// sigue siendo síncrono y el render no tiene que esperar a la red.
let cache: Report[] = [];
let state: StoreState = "loading";
let stateMessage: string | null = null;

const changes = createEmitter<Report[]>();
const states = createEmitter<{ state: StoreState; message: string | null }>();

function emit(): void {
  changes.emit(cache);
}

function retiredCount(): number {
  return cache.filter((report) => isRetired(report.status, report.statusAt, report.createdAt)).length;
}

/**
 * A point retires by the clock, and a clock crossing the threshold emits nothing
 * on its own: with the tab open, a report closed an hour ago — or one nobody has
 * touched all day — would stay drawn until the next write from anybody. One
 * timer for the whole store, and `emit()`
 * fans out to every subscriber through the paths they already use. The count
 * guard keeps quiet minutes free of renders.
 */
export function startRetireSweep(): void {
  let retired = retiredCount();
  setInterval(() => {
    const now = retiredCount();
    if (now === retired) return;
    retired = now;
    emit();
  }, 60_000);
}

/** La expone el arranque (`data/boot.ts`) para marcar carga, listo o error. */
export function setReportsState(next: StoreState, message: string | null = null): void {
  state = next;
  stateMessage = message;
  states.emit({ state, message: stateMessage });
}

/* ------------------------------------------------------------------ */
/* Serialización                                                       */
/* ------------------------------------------------------------------ */

// Las filas llegan de la red, así que se validan igual que antes se validaba
// lo que salía de localStorage: una fila rota no puede tumbar el render.
function isRow(value: unknown): value is Row {
  const r = value as Row;
  return (
    !!r &&
    typeof r.id === "string" &&
    typeof r.user_id === "string" &&
    typeof r.name === "string" &&
    typeof r.lat === "number" &&
    typeof r.lng === "number" &&
    Array.isArray(r.resources) &&
    typeof r.created_at === "string"
  );
}

// Los campos nuevos caen a un valor por defecto en vez de invalidar la fila:
// un reporte insertado por una versión anterior del cliente no puede
// desaparecer del mapa de los demás. Por eso `isRow` tampoco los exige.
function fromRow(row: Row): Report {
  return {
    id: row.id,
    name: row.name,
    placeName: text(row.place_name),
    lat: row.lat,
    lng: row.lng,
    resources: row.resources.filter((r): r is string => typeof r === "string"),
    covered: Array.isArray(row.covered)
      ? row.covered.filter((r): r is string => typeof r === "string")
      : [],
    status: isStatus(row.status) ? row.status : "activo",
    statusAt: typeof row.status_at === "string" ? row.status_at : row.created_at,
    note: text(row.note),
    contactName: text(row.contact_name),
    contactPhone: text(row.contact_phone),
    createdAt: row.created_at,
    userId: row.user_id,
  };
}

// `created_at` y `status_at` no se mandan: los pone el servidor. Un reloj mal
// puesto en el navegador desordenaría la lista para todo el mundo.
function toInsert(report: Report): Omit<Row, "created_at" | "status_at"> {
  return {
    id: report.id,
    user_id: report.userId,
    name: report.name,
    place_name: report.placeName,
    lat: report.lat,
    lng: report.lng,
    resources: report.resources,
    covered: report.covered,
    status: report.status,
    note: report.note,
    contact_name: report.contactName,
    // El CHECK de la base rechaza un teléfono sin nombre: sin saber por quién
    // preguntar, el número no le sirve a nadie.
    contact_phone: report.contactName ? report.contactPhone : null,
  };
}

/** Más reciente primero — el orden que asume `groupReports`. */
function sorted(reports: Report[]): Report[] {
  return [...reports].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

/* ------------------------------------------------------------------ */
/* Lectura                                                             */
/* ------------------------------------------------------------------ */

export function getReports(): Report[] {
  return cache;
}

export function getState(): { state: StoreState; message: string | null } {
  return { state, message: stateMessage };
}

/* ------------------------------------------------------------------ */
/* Escritura — optimista: local primero, red después                   */
/* ------------------------------------------------------------------ */

export function addReport(
  input: Omit<Report, "id" | "createdAt" | "statusAt" | "covered" | "userId">,
): Report {
  const now = new Date().toISOString();
  const report: Report = {
    ...input,
    covered: [],
    id: crypto.randomUUID(),
    createdAt: now,
    statusAt: now,
    userId: getUserId() ?? "",
  };
  cache = [report, ...cache];
  emit();
  void pushReport(report);
  return report;
}

async function pushReport(report: Report): Promise<void> {
  if (!supabase) {
    dropLocally(report.id);
    reportError(MISSING_ENV_MESSAGE);
    return;
  }
  if (!getUserId()) {
    dropLocally(report.id);
    reportError("Aún no hay sesión. Recarga la página e inténtalo de nuevo.");
    return;
  }

  // `.select()` devuelve la fila ya guardada: adopta el `created_at` del
  // servidor, que es el que ordena la lista para todos.
  const { data, error } = await supabase
    .from(TABLE)
    .insert(toInsert(report))
    .select()
    .single();

  if (error || !isRow(data)) {
    dropLocally(report.id);
    reportError(
      errorMessage(
        error,
        "No se pudo guardar el reporte. Revisa la conexión e inténtalo de nuevo.",
      ),
    );
    return;
  }

  const saved = fromRow(data);
  cache = sorted([...cache.filter((r) => r.id !== saved.id), saved]);
  emit();
}

function dropLocally(id: string): void {
  cache = cache.filter((report) => report.id !== id);
  emit();
}

export function removeReport(id: string): void {
  const previous = cache.find((report) => report.id === id);
  dropLocally(id);
  if (!previous) return;
  void (async () => {
    if (!supabase) return;
    const { error } = await supabase.from(TABLE).delete().eq("id", id);
    if (!error) return;
    // La policy solo deja borrar lo propio: si falla, el reporte sigue vivo
    // para todos los demás y la lista tiene que volver a mostrarlo.
    cache = sorted([...cache, previous]);
    emit();
    reportError("Solo puedes eliminar los reportes que creaste en este navegador.");
  })();
}

/** Marca (o reactiva) un recurso en varios reportes a la vez. */
export function setResourceCovered(ids: string[], resource: string, covered: boolean): void {
  const target = new Set(ids);
  cache = cache.map((report) => {
    if (!target.has(report.id) || !report.resources.includes(resource)) return report;
    const next = report.covered.filter((r) => r !== resource);
    if (covered) next.push(resource);
    return { ...report, covered: next };
  });
  emit();

  void (async () => {
    if (!supabase) return;
    // Vía RPC y no UPDATE: marcar cubierto es comunitario, pero nadie debe poder
    // reescribir el nombre ni las coordenadas de un reporte ajeno.
    const { error } = await supabase.rpc("set_resource_covered", {
      p_ids: ids,
      p_resource: resource,
      p_covered: covered,
    });
    if (!error) return;
    reportError(errorMessage(error, "No se pudo actualizar el estado del recurso."));
    await resync();
  })();
}

/**
 * Cambia el estado de todos los reportes de una zona a la vez.
 *
 * Comunitario, igual que «cubierto»: quien pasa por el punto sabe si está lleno
 * o si ya no reciben, y quien lo reportó hace tres horas ya no está ahí. El
 * riesgo de que alguien cierre un punto ajeno se acota en otro lado — el punto
 * no desaparece del mapa, solo cambia de forma y entra al banner, así que un
 * cierre falso es más visible, no menos.
 */
export function setReportStatus(ids: string[], status: ReportStatus): void {
  const target = new Set(ids);
  const now = new Date().toISOString();
  cache = cache.map((report) =>
    target.has(report.id) && report.status !== status
      ? { ...report, status, statusAt: now }
      : report,
  );
  emit();

  void (async () => {
    if (!supabase) return;
    const { error } = await supabase.rpc("set_report_status", {
      p_ids: ids,
      p_status: status,
    });
    if (!error) return;
    reportError(errorMessage(error, "No se pudo actualizar el estado del punto."));
    await resync();
  })();
}

/** Volver a la verdad del servidor: el cambio local optimista ya no vale. */
async function resync(): Promise<void> {
  try {
    await loadReports();
  } catch {
    setReportsState("error", "No se pudieron cargar los reportes. Revisa la conexión.");
  }
}

/* ------------------------------------------------------------------ */
/* Suscripción                                                         */
/* ------------------------------------------------------------------ */

export const onChange = changes.on;

export function onState(cb: (state: StoreState, message: string | null) => void): () => void {
  return states.on(({ state: next, message }) => cb(next, message));
}

/* ------------------------------------------------------------------ */
/* Arranque                                                            */
/* ------------------------------------------------------------------ */

/** Carga inicial desde el servidor. Lanza: el arranque decide qué mostrar. */
export async function loadReports(): Promise<void> {
  if (!supabase) return;
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  cache = (data ?? []).filter(isRow).map(fromRow);
  emit();
}

function applyRealtime(payload: RealtimePayload): void {
  if (payload.eventType === "DELETE") {
    // RLS no aplica a los DELETE de realtime: llega solo la primary key, que es
    // justo lo que hace falta para quitar el marcador.
    const id = (payload.old as { id?: string } | null)?.id;
    if (!id) return;
    cache = cache.filter((report) => report.id !== id);
    emit();
    return;
  }

  if (!isRow(payload.new)) return;
  const report = fromRow(payload.new);
  const others = cache.filter((r) => r.id !== report.id);
  cache = sorted([...others, report]);
  emit();
}

bindTable(TABLE, applyRealtime);
