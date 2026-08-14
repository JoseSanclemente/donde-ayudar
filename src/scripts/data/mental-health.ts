import { MISSING_ENV_MESSAGE, supabase } from "../supabase";
import { createEmitter } from "./emitter";
import { errorMessage, reportError } from "./errors";
import { bindTable, type RealtimePayload } from "./live";
import { getUserId } from "./session";

/**
 * Quien se ofrece a acompañar a la comunidad: un nombre, cómo escribirle y —si
 * quiere— en qué puede ayudar.
 *
 * Es `offers` en su forma, sin la parte comunitaria: una inscripción no se
 * despacha a ningún punto ni se marca como finalizada, así que no hay RPC. Está
 * en pie o la retira quien la publicó. La diferencia con `offers` es el
 * contacto: acá puede ser un WhatsApp o un Instagram, y basta con uno —quien
 * acompaña no siempre quiere dar su número—, y la base lo exige con un CHECK.
 */
export type Volunteer = {
  id: string;
  name: string;
  contactPhone: string | null;
  /** El handle sin `@` ni url: lo normaliza el formulario antes de guardarlo. */
  contactInstagram: string | null;
  notes: string | null;
  createdAt: string;
  userId: string;
};

type Row = {
  id: string;
  user_id: string;
  name: string;
  contact_phone: string | null;
  contact_instagram: string | null;
  notes: string | null;
  created_at: string;
};

const TABLE = "mental_health_volunteers";

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
    typeof r.user_id === "string" &&
    typeof r.name === "string" &&
    typeof r.created_at === "string"
  );
}

function fromRow(row: Row): Volunteer {
  return {
    id: row.id,
    name: row.name,
    contactPhone: text(row.contact_phone),
    contactInstagram: text(row.contact_instagram),
    notes: text(row.notes),
    createdAt: row.created_at,
    userId: row.user_id,
  };
}

/** Lo más reciente arriba, y nada más: acá no hay estados que ordenar. */
function sorted(volunteers: Volunteer[]): Volunteer[] {
  return [...volunteers].sort(
    (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
  );
}

export function getVolunteers(): Volunteer[] {
  return cache;
}

export const onVolunteers = changes.on;

export function addVolunteer(input: {
  name: string;
  contactPhone: string | null;
  contactInstagram: string | null;
  notes: string | null;
}): Volunteer {
  const volunteer: Volunteer = {
    ...input,
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

export function removeVolunteer(id: string): void {
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

export async function loadVolunteers(): Promise<void> {
  if (!supabase) return;
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);
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
