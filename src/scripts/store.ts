import { MISSING_ENV_MESSAGE, supabase } from "./supabase";

export type Report = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  resources: string[];
  /** Subconjunto de `resources` que la zona ya no necesita. */
  covered: string[];
  createdAt: string;
  /** Dueño del reporte. Solo él puede borrarlo (policy de RLS). */
  userId: string;
};

/** Fila tal como viaja por la red — snake_case, como la tabla. */
type Row = {
  id: string;
  user_id: string;
  name: string;
  lat: number;
  lng: number;
  resources: string[];
  covered: string[] | null;
  created_at: string;
};

export type StoreState = "loading" | "ready" | "error";

const TABLE = "reports";

/* ------------------------------------------------------------------ */
/* Estado                                                              */
/* ------------------------------------------------------------------ */

// Caché en memoria: es la única fuente que lee la UI, así que `getReports()`
// sigue siendo síncrono y el render no tiene que esperar a la red.
let cache: Report[] = [];
let userId: string | null = null;
let state: StoreState = "loading";
let stateMessage: string | null = null;

type Listener = (reports: Report[]) => void;
type StateListener = (state: StoreState, message: string | null) => void;
type ErrorListener = (message: string) => void;

const listeners = new Set<Listener>();
const stateListeners = new Set<StateListener>();
const errorListeners = new Set<ErrorListener>();

function emit(): void {
  for (const listener of listeners) listener(cache);
}

function setState(next: StoreState, message: string | null = null): void {
  state = next;
  stateMessage = message;
  for (const listener of stateListeners) listener(state, stateMessage);
}

/** Fallo de una escritura puntual, con la caché ya revertida. */
function reportError(message: string): void {
  for (const listener of errorListeners) listener(message);
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

function fromRow(row: Row): Report {
  return {
    id: row.id,
    name: row.name,
    lat: row.lat,
    lng: row.lng,
    resources: row.resources.filter((r): r is string => typeof r === "string"),
    covered: Array.isArray(row.covered)
      ? row.covered.filter((r): r is string => typeof r === "string")
      : [],
    createdAt: row.created_at,
    userId: row.user_id,
  };
}

// `created_at` no se manda: lo pone el servidor. Un reloj mal puesto en el
// navegador desordenaría la lista para todo el mundo.
function toInsert(report: Report): Omit<Row, "created_at"> {
  return {
    id: report.id,
    user_id: report.userId,
    name: report.name,
    lat: report.lat,
    lng: report.lng,
    resources: report.resources,
    covered: report.covered,
  };
}

/** Más reciente primero — el orden que asume `groupReports`. */
function sorted(reports: Report[]): Report[] {
  return [...reports].sort(
    (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
  );
}

/* ------------------------------------------------------------------ */
/* Lectura                                                             */
/* ------------------------------------------------------------------ */

export function getReports(): Report[] {
  return cache;
}

/** `null` mientras no haya sesión anónima. */
export function getUserId(): string | null {
  return userId;
}

export function isMine(report: Report): boolean {
  return userId !== null && report.userId === userId;
}

export function getState(): { state: StoreState; message: string | null } {
  return { state, message: stateMessage };
}

/* ------------------------------------------------------------------ */
/* Escritura — optimista: local primero, red después                   */
/* ------------------------------------------------------------------ */

export function addReport(
  input: Omit<Report, "id" | "createdAt" | "covered" | "userId">,
): Report {
  const report: Report = {
    ...input,
    covered: [],
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    userId: userId ?? "",
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
  if (!userId) {
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
    reportError("No se pudo guardar el reporte. Revisa la conexión e inténtalo de nuevo.");
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
    reportError("No se pudo actualizar el estado del recurso.");
    // Volver a la verdad del servidor: el toggle local ya no vale.
    try {
      await refresh();
    } catch {
      setState("error", "No se pudieron cargar los reportes. Revisa la conexión.");
    }
  })();
}

/* ------------------------------------------------------------------ */
/* Suscripción                                                         */
/* ------------------------------------------------------------------ */

export function onChange(cb: Listener): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function onState(cb: StateListener): () => void {
  stateListeners.add(cb);
  return () => stateListeners.delete(cb);
}

export function onError(cb: ErrorListener): () => void {
  errorListeners.add(cb);
  return () => errorListeners.delete(cb);
}

/* ------------------------------------------------------------------ */
/* Arranque                                                            */
/* ------------------------------------------------------------------ */

async function refresh(): Promise<void> {
  if (!supabase) return;
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  cache = (data ?? []).filter(isRow).map(fromRow);
  emit();
}

function applyRealtime(payload: {
  eventType: string;
  new: unknown;
  old: unknown;
}): void {
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

function subscribe(): void {
  supabase
    ?.channel("reports")
    .on("postgres_changes", { event: "*", schema: "public", table: TABLE }, applyRealtime)
    .subscribe();
}

/** Sesión anónima + carga inicial + realtime. Se llama una vez, en el boot. */
export async function initStore(): Promise<void> {
  if (!supabase) {
    setState("error", MISSING_ENV_MESSAGE);
    return;
  }
  setState("loading");
  try {
    // Una sesión anónima por navegador: da el `uid` que las policies usan para
    // decidir quién puede borrar qué. No pide correo ni contraseña.
    const { data: sessionData } = await supabase.auth.getSession();
    userId = sessionData.session?.user.id ?? null;
    if (!userId) {
      const { data, error } = await supabase.auth.signInAnonymously();
      if (error) throw error;
      userId = data.user?.id ?? null;
    }

    await refresh();
    subscribe();
    setState("ready");
  } catch {
    setState("error", "No se pudieron cargar los reportes. Revisa la conexión.");
  }
}
