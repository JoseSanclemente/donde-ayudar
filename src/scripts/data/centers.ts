import {
  isLapsed,
  type Center,
  type CenterType,
  type Origin,
} from "../centers";
import { categoryItemsEnPunto, isCategoryId } from "../resources";
import { MISSING_ENV_MESSAGE, supabase } from "../supabase";
import { createEmitter } from "./emitter";
import { errorMessage, reportError } from "./errors";
import { bindTable, type RealtimePayload } from "./live";
import { getUserId } from "./session";

/**
 * Centers — collection points, shelters, blood banks, healthcare points and
 * municipalities asking for help.
 *
 * The narrowest write path of the four stores, and on purpose. There is no
 * update policy at all, so nothing here edits a point once it is published, and
 * the insert only accepts a collection point registered by the community
 * (`origin: "comunidad"`, `user_id` the current session). The other four types
 * are a maintainer's, written with SQL, which runs as `service_role` and
 * bypasses RLS.
 */
type Row = {
  id: string;
  type: string;
  origin: string | null;
  user_id: string | null;
  name: string;
  address: string;
  lat: number;
  lng: number;
  hours: string;
  contact_whatsapp: string | null;
  contact_instagram: string | null;
  notes: string | null;
  donations: string[] | null;
  accepting_donations: boolean | null;
  is_active: boolean | null;
  updated_at: string | null;
  created_at: string | null;
};

export type NewCollectionCenter = {
  name: string;
  address: string;
  lat: number;
  lng: number;
  hours: string;
  contactWhatsapp: string | null;
  contactInstagram: string | null;
  notes: string | null;
  donations: string[];
};

const TABLE = "centers";

const TYPES: CenterType[] = [
  "acopio",
  "albergue",
  "sangre",
  "healthcare",
  "municipio",
];

let cache: Center[] = [];
const changes = createEmitter<Center[]>();

/**
 * What leaves this module. The cache keeps every row it read, and a lapsed
 * `municipio` is filtered here and not on load, because it lapses by clock: the
 * tab open since last month has to stop drawing it without a new payload, and
 * the repaint in `features/centers-layer.ts` asks again every five minutes.
 */
function visible(): Center[] {
  return cache.filter((center) => !isLapsed(center));
}

function emit(): void {
  changes.emit(visible());
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

/**
 * The column stored category ids before it stored supply names. The migration
 * expanded the rows there were, but SQL is still a hand-written surface: a
 * maintainer who types `salud` has to keep publishing what they always did, not
 * an «Otros» chip.
 */
function expandDonations(donations: unknown): string[] {
  if (!Array.isArray(donations)) return [];
  const items = donations
    .filter((value): value is string => typeof value === "string")
    .flatMap((value) =>
      isCategoryId(value) ? categoryItemsEnPunto(value) : value.trim(),
    );
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
    TYPES.includes(r.type as CenterType) &&
    typeof r.name === "string" &&
    typeof r.lat === "number" &&
    typeof r.lng === "number"
  );
}

function fromRow(row: Row): Center {
  const updatedAt = text(row.updated_at) ?? new Date().toISOString();
  return {
    id: row.id,
    type: row.type as CenterType,
    origin: (row.origin === "comunidad" ? "comunidad" : "curado") as Origin,
    userId: row.user_id ?? null,
    name: row.name,
    address: row.address ?? "",
    lat: row.lat,
    lng: row.lng,
    hours: row.hours ?? "",
    contactWhatsapp: text(row.contact_whatsapp),
    contactInstagram: text(row.contact_instagram),
    notes: text(row.notes),
    donations: expandDonations(row.donations),

    acceptingDonations: row.accepting_donations ?? true,
    isActive: row.is_active ?? true,

    updatedAt,

    createdAt: text(row.created_at) ?? updatedAt,
  };
}

function sorted(list: Center[]): Center[] {
  return [...list].sort((a, b) => a.name.localeCompare(b.name, "es"));
}

export function getCenters(): Center[] {
  return visible();
}

export const onCenters = changes.on;

export async function loadCenters(): Promise<void> {
  if (!supabase) return;
  const { data, error } = await supabase.from(TABLE).select("*");
  if (error) throw error;
  cache = sorted((data ?? []).filter(isRow).map(fromRow));
  emit();
}

/**
 * Publishes a collection point. Returns the center already in the cache: the
 * marker shows up before the insert comes back, and if the insert fails it
 * takes itself off.
 *
 * The id is a uuid and not a slug of the name: the table's CHECK accepts
 * lowercase, digits and dashes, which is exactly what a uuid brings, so two
 * people registering «Colegio San José» at once do not collide.
 */
export function addCenter(input: NewCollectionCenter): Center {
  const center: Center = {
    ...input,
    id: crypto.randomUUID(),
    type: "acopio",
    origin: "comunidad",
    userId: getUserId() ?? "",
    contactWhatsapp: input.contactWhatsapp ?? undefined,
    contactInstagram: input.contactInstagram ?? undefined,
    notes: input.notes ?? undefined,
    acceptingDonations: true,
    isActive: true,
    updatedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  };
  cache = sorted([...cache, center]);
  emit();
  void pushCenter(center);
  return center;
}

async function pushCenter(center: Center): Promise<void> {
  if (!supabase) {
    dropLocally(center.id);
    reportError(MISSING_ENV_MESSAGE);
    return;
  }
  const userId = getUserId();
  if (!userId) {
    dropLocally(center.id);
    reportError("Aún no hay sesión. Recarga la página e inténtalo de nuevo.");
    return;
  }

  const { data, error } = await supabase
    .from(TABLE)
    .insert({
      id: center.id,
      type: "acopio",
      origin: "comunidad",
      user_id: userId,
      name: center.name,
      address: center.address,
      lat: center.lat,
      lng: center.lng,
      hours: center.hours,
      contact_whatsapp: center.contactWhatsapp ?? null,
      contact_instagram: center.contactInstagram ?? null,
      notes: center.notes ?? null,
      donations: center.donations,
    })
    .select()
    .single();

  if (error || !isRow(data)) {
    dropLocally(center.id);
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
  cache = cache.filter((center) => center.id !== id);
  emit();
}

export function removeCenter(id: string): void {
  const previous = cache.find((center) => center.id === id);
  dropLocally(id);
  if (!previous) return;
  void (async () => {
    if (!supabase) return;
    const { error } = await supabase.from(TABLE).delete().eq("id", id);
    if (!error) return;

    cache = sorted([...cache, previous]);
    emit();
    reportError(
      "Solo puedes eliminar los puntos que registraste en este navegador.",
    );
  })();
}

/**
 * Says the point is still open and restarts its day of validity.
 *
 * Communal, like «cubierto»: whoever walks past the warehouse knows whether it
 * is still open, and whoever registered it last night is not there any more.
 * Through an RPC because the table has no UPDATE policy: `confirm_center`
 * touches `updated_at` and nothing else.
 */
export function confirmCenter(id: string): void {
  const previous = cache.find((center) => center.id === id);
  if (!previous) return;

  const now = new Date().toISOString();
  cache = cache.map((center) =>
    center.id === id ? { ...center, updatedAt: now } : center,
  );
  emit();

  void (async () => {
    if (!supabase) return;
    const { error } = await supabase.rpc("confirm_center", { p_id: id });
    if (!error) return;

    cache = cache.map((center) =>
      center.id === id ? { ...center, updatedAt: previous.updatedAt } : center,
    );
    emit();
    reportError(
      errorMessage(error, "No se pudo confirmar el punto. Revisa la conexión."),
    );
  })();
}

function applyRealtime(payload: RealtimePayload): void {
  if (payload.eventType === "DELETE") {
    const id = (payload.old as { id?: string } | null)?.id;
    if (!id) return;
    cache = cache.filter((center) => center.id !== id);
    emit();
    return;
  }

  if (!isRow(payload.new)) return;
  const center = fromRow(payload.new);
  cache = sorted([...cache.filter((c) => c.id !== center.id), center]);
  emit();
}

bindTable(TABLE, applyRealtime);
