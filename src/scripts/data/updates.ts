import { MISSING_ENV_MESSAGE, supabase } from "../supabase";
import { createEmitter } from "./emitter";
import { errorMessage, reportError } from "./errors";
import { bindTable, type RealtimePayload } from "./live";
import { getUserId } from "./session";

/**
 * Novedades: la bitácora de la ciudad. Una línea corta, con hora, en orden.
 *
 * Es la forma en que la gente consume esto de verdad — sale de un grupo de
 * WhatsApp — y es lo que mantiene fresco un punto sin que nadie tenga que
 * volver a reportarlo. Sin `update` en la base a propósito: una bitácora que se
 * puede reescribir deja de ser bitácora.
 */
export type Update = {
  id: string;
  body: string;

  reportId: string | null;
  createdAt: string;
  userId: string;
};

type Row = {
  id: string;
  user_id: string;
  report_id: string | null;
  body: string;
  created_at: string;
};

const TABLE = "updates";

let cache: Update[] = [];
const changes = createEmitter<Update[]>();

function emit(): void {
  changes.emit(cache);
}

function isRow(value: unknown): value is Row {
  const r = value as Row;
  return (
    !!r &&
    typeof r.id === "string" &&
    typeof r.user_id === "string" &&
    typeof r.body === "string" &&
    typeof r.created_at === "string"
  );
}

function fromRow(row: Row): Update {
  return {
    id: row.id,
    body: row.body,
    reportId: typeof row.report_id === "string" ? row.report_id : null,
    createdAt: row.created_at,
    userId: row.user_id,
  };
}

function sorted(updates: Update[]): Update[] {
  return [...updates].sort(
    (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
  );
}

export function getUpdates(): Update[] {
  return cache;
}

export function getUpdatesFor(reportId: string): Update[] {
  return cache.filter((update) => update.reportId === reportId);
}

/**
 * Índice de la última novedad por punto. Se rearma en cada emisión y no en cada
 * consulta: la lista lo pregunta una vez por grupo en cada repintado.
 */
let latest = new Map<string, Update>();

function reindex(): void {
  latest = new Map();

  for (const update of cache) {
    if (update.reportId && !latest.has(update.reportId))
      latest.set(update.reportId, update);
  }
}

export function latestUpdateFor(reportId: string): Update | null {
  return latest.get(reportId) ?? null;
}

export const onUpdates = changes.on;

export function addUpdate(input: {
  body: string;
  reportId: string | null;
}): Update {
  const update: Update = {
    id: crypto.randomUUID(),
    body: input.body,
    reportId: input.reportId,
    createdAt: new Date().toISOString(),
    userId: getUserId() ?? "",
  };
  cache = [update, ...cache];
  reindex();
  emit();
  void push(update);
  return update;
}

async function push(update: Update): Promise<void> {
  if (!supabase) {
    dropLocally(update.id);
    reportError(MISSING_ENV_MESSAGE);
    return;
  }
  if (!getUserId()) {
    dropLocally(update.id);
    reportError("Aún no hay sesión. Recarga la página e inténtalo de nuevo.");
    return;
  }

  const { data, error } = await supabase
    .from(TABLE)
    .insert({
      id: update.id,
      user_id: update.userId,
      report_id: update.reportId,
      body: update.body,
    })
    .select()
    .single();

  if (error || !isRow(data)) {
    dropLocally(update.id);
    reportError(
      errorMessage(
        error,
        "No se pudo publicar la novedad. Revisa la conexión.",
      ),
    );
    return;
  }

  const saved = fromRow(data);
  cache = sorted([...cache.filter((u) => u.id !== saved.id), saved]);
  reindex();
  emit();
}

function dropLocally(id: string): void {
  cache = cache.filter((update) => update.id !== id);
  reindex();
  emit();
}

export function removeUpdate(id: string): void {
  const previous = cache.find((update) => update.id === id);
  dropLocally(id);
  if (!previous) return;
  void (async () => {
    if (!supabase) return;
    const { error } = await supabase.from(TABLE).delete().eq("id", id);
    if (!error) return;
    cache = sorted([...cache, previous]);
    reindex();
    emit();
    reportError(
      "Solo puedes borrar las novedades que publicaste en este navegador.",
    );
  })();
}

export async function loadUpdates(): Promise<void> {
  if (!supabase) return;
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .order("created_at", { ascending: false })

    .limit(200);
  if (error) throw error;
  cache = (data ?? []).filter(isRow).map(fromRow);
  reindex();
  emit();
}

function applyRealtime(payload: RealtimePayload): void {
  if (payload.eventType === "DELETE") {
    const id = (payload.old as { id?: string } | null)?.id;
    if (!id) return;
    cache = cache.filter((update) => update.id !== id);
    reindex();
    emit();
    return;
  }

  if (!isRow(payload.new)) return;
  const update = fromRow(payload.new);
  cache = sorted([...cache.filter((u) => u.id !== update.id), update]);
  reindex();
  emit();
}

bindTable(TABLE, applyRealtime);
