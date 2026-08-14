import { MISSING_ENV_MESSAGE, supabase } from "../supabase";
import type { VolunteerKind } from "../volunteers";
import { createEmitter } from "./emitter";
import { errorMessage, reportError } from "./errors";
import { bindTable, type RealtimePayload } from "./live";
import { getUserId } from "./session";

/**
 * Whoever offers their own time to the community: a name, how to write to them
 * and — if they want — what they can help with.
 *
 * It is `offers` in shape, without the communal part: a signup is not dispatched
 * to any point and is never marked finished, so there is no RPC. It stands, or
 * whoever published it withdraws it. What differs from `offers` is the contact:
 * here it can be a WhatsApp or an Instagram, and one of the two is enough —
 * whoever listens does not always hand out their number — and the database
 * demands it with a CHECK.
 *
 * One table for every panel, told apart by `kind`: the cache, the initial load
 * and the realtime channel are single, and each panel keeps its own part by
 * asking for a `volunteerStore(kind)`.
 */
export type Volunteer = {
  id: string;
  kind: VolunteerKind;
  name: string;
  contactPhone: string | null;
  /** The handle with no `@` and no url: the form normalises it before saving. */
  contactInstagram: string | null;
  notes: string | null;
  createdAt: string;
  userId: string;
};

type Row = {
  id: string;
  kind: string;
  user_id: string;
  name: string;
  contact_phone: string | null;
  contact_instagram: string | null;
  notes: string | null;
  created_at: string;
};

const TABLE = "volunteers";

let cache: Volunteer[] = [];
const changes = createEmitter<Volunteer[]>();

function emit(): void {
  changes.emit(cache);
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function isRow(value: unknown): value is Row {
  const r = value as Row;
  return (
    !!r &&
    typeof r.id === "string" &&
    typeof r.kind === "string" &&
    typeof r.user_id === "string" &&
    typeof r.name === "string" &&
    typeof r.created_at === "string"
  );
}

function fromRow(row: Row): Volunteer {
  return {
    id: row.id,
    kind: row.kind as VolunteerKind,
    name: row.name,
    contactPhone: text(row.contact_phone),
    contactInstagram: text(row.contact_instagram),
    notes: text(row.notes),
    createdAt: row.created_at,
    userId: row.user_id,
  };
}

/** Newest first, and nothing else: there are no statuses to order here. */
function sorted(volunteers: Volunteer[]): Volunteer[] {
  return [...volunteers].sort(
    (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
  );
}

type VolunteerInput = {
  name: string;
  contactPhone: string | null;
  contactInstagram: string | null;
  notes: string | null;
};

function addVolunteer(kind: VolunteerKind, input: VolunteerInput): Volunteer {
  const volunteer: Volunteer = {
    ...input,
    kind,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    userId: getUserId() ?? "",
  };
  cache = sorted([volunteer, ...cache]);
  emit();
  void push(volunteer);
  return volunteer;
}

async function push(volunteer: Volunteer): Promise<void> {
  if (!supabase) {
    dropLocally(volunteer.id);
    reportError(MISSING_ENV_MESSAGE);
    return;
  }
  if (!getUserId()) {
    dropLocally(volunteer.id);
    reportError("Aún no hay sesión. Recarga la página e inténtalo de nuevo.");
    return;
  }

  const { data, error } = await supabase
    .from(TABLE)
    .insert({
      id: volunteer.id,
      kind: volunteer.kind,
      user_id: volunteer.userId,
      name: volunteer.name,
      contact_phone: volunteer.contactPhone,
      contact_instagram: volunteer.contactInstagram,
      notes: volunteer.notes,
    })
    .select()
    .single();

  if (error || !isRow(data)) {
    dropLocally(volunteer.id);
    reportError(
      errorMessage(error, "No se pudo guardar tu inscripción. Revisa la conexión."),
    );
    return;
  }

  const saved = fromRow(data);
  cache = sorted([...cache.filter((v) => v.id !== saved.id), saved]);
  emit();
}

function dropLocally(id: string): void {
  cache = cache.filter((volunteer) => volunteer.id !== id);
  emit();
}

function removeVolunteer(id: string): void {
  const previous = cache.find((volunteer) => volunteer.id === id);
  dropLocally(id);
  if (!previous) return;
  void (async () => {
    if (!supabase) return;
    const { error } = await supabase.from(TABLE).delete().eq("id", id);
    if (!error) return;
    cache = sorted([...cache, previous]);
    emit();
    reportError(
      "Solo puedes retirar las inscripciones que hiciste en este navegador.",
    );
  })();
}

/**
 * What a panel sees: its own `kind` and nothing else. The load limit is for the
 * whole table, so it grows with every panel added.
 */
export function volunteerStore(kind: VolunteerKind) {
  return {
    getVolunteers: (): Volunteer[] =>
      cache.filter((volunteer) => volunteer.kind === kind),
    onVolunteers: (listener: (volunteers: Volunteer[]) => void) =>
      changes.on((volunteers) =>
        listener(volunteers.filter((volunteer) => volunteer.kind === kind)),
      ),
    addVolunteer: (input: VolunteerInput): Volunteer =>
      addVolunteer(kind, input),
    removeVolunteer,
  };
}

export async function loadVolunteers(): Promise<void> {
  if (!supabase) return;
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .order("created_at", { ascending: false })
    .limit(400);
  if (error) throw error;
  cache = sorted((data ?? []).filter(isRow).map(fromRow));
  emit();
}

function applyRealtime(payload: RealtimePayload): void {
  if (payload.eventType === "DELETE") {
    const id = (payload.old as { id?: string } | null)?.id;
    if (!id) return;
    cache = cache.filter((volunteer) => volunteer.id !== id);
    emit();
    return;
  }

  if (!isRow(payload.new)) return;
  const volunteer = fromRow(payload.new);
  cache = sorted([...cache.filter((v) => v.id !== volunteer.id), volunteer]);
  emit();
}

bindTable(TABLE, applyRealtime);
