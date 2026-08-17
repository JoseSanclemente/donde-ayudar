import { MISSING_ENV_MESSAGE, supabase } from "../supabase";
import { createEmitter } from "./emitter";
import { errorMessage, reportError } from "./errors";
import { bindTable, type RealtimePayload } from "./live";
import { getUserId } from "./session";
import { latestUpdateFor, onUpdates } from "./updates";
import { isRetired, isStatus, type ReportStatus } from "../status";
import { newestIso } from "../ui/time";

export type Report = {
  id: string;

  name: string;

  placeName: string | null;
  lat: number;
  lng: number;
  resources: string[];

  covered: string[];

  status: ReportStatus;

  statusAt: string;

  note: string | null;

  contactName: string | null;
  contactPhone: string | null;
  createdAt: string;

  userId: string;
};

/**
 * A report on a single line, for the selects that point at it. The venue name
 * leads when there is one, and the address always follows — it is what actually
 * gets you there, and two points on the same block read alike without it.
 */
export function reportLabel(report: Report): string {
  return report.placeName
    ? `${report.placeName} - ${report.name}`
    : report.name;
}

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

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

export type StoreState = "loading" | "ready" | "error";

const TABLE = "reports";

let cache: Report[] = [];
let state: StoreState = "loading";
let stateMessage: string | null = null;

const changes = createEmitter<Report[]>();
const states = createEmitter<{ state: StoreState; message: string | null }>();

function emit(): void {
  changes.emit(cache);
}

/**
 * Lo más reciente que se sabe de un reporte: se creó, le tocaron el estado o
 * alguien escribió una novedad sobre él. Es lo que decide si el punto sigue
 * vivo (`isRetired`) y lo que la lista pinta como «Actualizado hace X».
 *
 * Vive acá y no en `status.ts` porque la respuesta cruza dos tablas: una
 * novedad cuelga de un reporte por `report_id`, y ninguna de las dos filas sabe
 * de la otra. Este es el único sitio donde un store lee otro store, y es lo que
 * evita que cada consumidor arme la mezcla por su cuenta —que era justo lo que
 * pasaba: el mapa retiraba un punto que la lista mostraba recién actualizado.
 * `latestUpdateFor` lee un índice ya armado, así que no cuesta recorrer nada.
 */
export function reportFreshAt(report: Report): string {
  return newestIso(
    report.createdAt,
    report.statusAt,
    latestUpdateFor(report.id)?.createdAt,
  );
}

function retiredCount(): number {
  return cache.filter((report) =>
    isRetired(report.status, report.statusAt, reportFreshAt(report)),
  ).length;
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
  onUpdates(() => emit());

  let retired = retiredCount();
  setInterval(() => {
    const now = retiredCount();
    if (now === retired) return;
    retired = now;
    emit();
  }, 60_000);
}

export function setReportsState(
  next: StoreState,
  message: string | null = null,
): void {
  state = next;
  stateMessage = message;
  states.emit({ state, message: stateMessage });
}

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
    statusAt:
      typeof row.status_at === "string" ? row.status_at : row.created_at,
    note: text(row.note),
    contactName: text(row.contact_name),
    contactPhone: text(row.contact_phone),
    createdAt: row.created_at,
    userId: row.user_id,
  };
}

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

    contact_phone: report.contactName ? report.contactPhone : null,
  };
}

function sorted(reports: Report[]): Report[] {
  return [...reports].sort(
    (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
  );
}

export function getReports(): Report[] {
  return cache;
}

export function getState(): { state: StoreState; message: string | null } {
  return { state, message: stateMessage };
}

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

    cache = sorted([...cache, previous]);
    emit();
    reportError(
      "Solo puedes eliminar los reportes que creaste en este navegador.",
    );
  })();
}

export function setResourceCovered(
  ids: string[],
  resource: string,
  covered: boolean,
): void {
  const target = new Set(ids);
  cache = cache.map((report) => {
    if (!target.has(report.id) || !report.resources.includes(resource))
      return report;
    const next = report.covered.filter((r) => r !== resource);
    if (covered) next.push(resource);
    return { ...report, covered: next };
  });
  emit();

  void (async () => {
    if (!supabase) return;

    const { error } = await supabase.rpc("set_resource_covered", {
      p_ids: ids,
      p_resource: resource,
      p_covered: covered,
    });
    if (!error) return;
    reportError(
      errorMessage(error, "No se pudo actualizar el estado del recurso."),
    );
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
    reportError(
      errorMessage(error, "No se pudo actualizar el estado del punto."),
    );
    await resync();
  })();
}

async function resync(): Promise<void> {
  try {
    await loadReports();
  } catch {
    setReportsState(
      "error",
      "No se pudieron cargar los reportes. Revisa la conexión.",
    );
  }
}

export const onChange = changes.on;

export function onState(
  cb: (state: StoreState, message: string | null) => void,
): () => void {
  return states.on(({ state: next, message }) => cb(next, message));
}

export async function loadReports(): Promise<void> {
  if (!supabase) return;
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .order("created_at", { ascending: false })

    .limit(500);
  if (error) throw error;
  cache = (data ?? []).filter(isRow).map(fromRow);
  emit();
}

function applyRealtime(payload: RealtimePayload): void {
  if (payload.eventType === "DELETE") {
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
