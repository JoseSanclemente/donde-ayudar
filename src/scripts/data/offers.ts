import { MISSING_ENV_MESSAGE, supabase } from "../supabase";
import { createEmitter } from "./emitter";
import { errorMessage, reportError } from "./errors";
import { bindTable, type RealtimePayload } from "./live";
import { getUserId } from "./session";

/**
 * Ofertas: lo que alguien tiene a mano y todavía no sabe adónde llevar — una
 * retroexcavadora, una camioneta, veinte colchonetas.
 *
 * Es el reverso del reporte: el reporte dice qué falta en un punto, la oferta
 * dice qué sobra en la ciudad. Asignarla a un punto es comunitario (va por el
 * RPC `assign_offer`), porque quien coordina en la calle casi nunca es quien
 * publicó la máquina.
 */
export type Offer = {
  id: string;
  title: string;
  detail: string | null;
  /** Id de categoría de `resources.ts`, o `null` si no encaja en ninguna. */
  category: string | null;
  /** Acá el contacto no es opcional: una oferta sin a quién llamar no se despacha. */
  contactName: string;
  contactPhone: string;
  /** Punto al que ya se despachó, o `null` mientras siga disponible. */
  reportId: string | null;
  assignedAt: string | null;
  /** When it was called done, or `null` while it still stands. */
  finishedAt: string | null;
  createdAt: string;
  userId: string;
};

type Row = {
  id: string;
  user_id: string;
  title: string;
  detail: string | null;
  category: string | null;
  contact_name: string;
  contact_phone: string;
  report_id: string | null;
  assigned_at: string | null;
  finished_at: string | null;
  created_at: string;
};

const TABLE = "offers";

let cache: Offer[] = [];
const changes = createEmitter<Offer[]>();

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
    typeof r.title === "string" &&
    typeof r.contact_name === "string" &&
    typeof r.contact_phone === "string" &&
    typeof r.created_at === "string"
  );
}

function fromRow(row: Row): Offer {
  return {
    id: row.id,
    title: row.title,
    detail: text(row.detail),
    category: text(row.category),
    contactName: row.contact_name,
    contactPhone: row.contact_phone,
    reportId: text(row.report_id),
    assignedAt: text(row.assigned_at),
    finishedAt: text(row.finished_at),
    createdAt: row.created_at,
    userId: row.user_id,
  };
}

/**
 * Sin despachar primero, y dentro de cada bloque lo más reciente arriba: lo que
 * hay que mover es lo que todavía no tiene destino.
 *
 * A finished offer sinks below both blocks. It is kept in the list — anyone can
 * untick it, and something that disappeared could not be corrected — but it is
 * not capacity anymore, so it does not sit on top of what still is.
 */
function sorted(offers: Offer[]): Offer[] {
  return [...offers].sort((a, b) => {
    if (!a.finishedAt !== !b.finishedAt) return a.finishedAt ? 1 : -1;
    if (!a.reportId !== !b.reportId) return a.reportId ? 1 : -1;
    return Date.parse(b.createdAt) - Date.parse(a.createdAt);
  });
}

export function getOffers(): Offer[] {
  return cache;
}

/** Lo que ya se despachó a un punto. Lo usa la lista para mostrarlo en su ficha. */
export function getOffersFor(reportId: string): Offer[] {
  return cache.filter((offer) => offer.reportId === reportId);
}

export const onOffers = changes.on;

export function addOffer(input: {
  title: string;
  detail: string | null;
  category: string | null;
  contactName: string;
  contactPhone: string;
}): Offer {
  const offer: Offer = {
    ...input,
    id: crypto.randomUUID(),
    reportId: null,
    assignedAt: null,
    finishedAt: null,
    createdAt: new Date().toISOString(),
    userId: getUserId() ?? "",
  };
  cache = sorted([offer, ...cache]);
  emit();
  void push(offer);
  return offer;
}

async function push(offer: Offer): Promise<void> {
  if (!supabase) {
    dropLocally(offer.id);
    reportError(MISSING_ENV_MESSAGE);
    return;
  }
  if (!getUserId()) {
    dropLocally(offer.id);
    reportError("Aún no hay sesión. Recarga la página e inténtalo de nuevo.");
    return;
  }

  const { data, error } = await supabase
    .from(TABLE)
    .insert({
      id: offer.id,
      user_id: offer.userId,
      title: offer.title,
      detail: offer.detail,
      category: offer.category,
      contact_name: offer.contactName,
      contact_phone: offer.contactPhone,
    })
    .select()
    .single();

  if (error || !isRow(data)) {
    dropLocally(offer.id);
    reportError(errorMessage(error, "No se pudo publicar la ayuda. Revisa la conexión."));
    return;
  }

  const saved = fromRow(data);
  cache = sorted([...cache.filter((o) => o.id !== saved.id), saved]);
  emit();
}

function dropLocally(id: string): void {
  cache = cache.filter((offer) => offer.id !== id);
  emit();
}

export function removeOffer(id: string): void {
  const previous = cache.find((offer) => offer.id === id);
  dropLocally(id);
  if (!previous) return;
  void (async () => {
    if (!supabase) return;
    const { error } = await supabase.from(TABLE).delete().eq("id", id);
    if (!error) return;
    cache = sorted([...cache, previous]);
    emit();
    reportError("Solo puedes retirar las ofertas que publicaste en este navegador.");
  })();
}

/**
 * Manda una oferta a un punto, o la devuelve a la bolsa con `null`.
 *
 * No hay policy de UPDATE en la tabla: un UPDATE abierto dejaría reescribir el
 * teléfono de otro, así que solo estas dos columnas se mueven, y por RPC.
 */
export function assignOffer(id: string, reportId: string | null): void {
  const previous = cache.find((offer) => offer.id === id);
  if (!previous) return;

  cache = sorted(
    cache.map((offer) =>
      offer.id === id
        ? { ...offer, reportId, assignedAt: reportId ? new Date().toISOString() : null }
        : offer,
    ),
  );
  emit();

  void (async () => {
    if (!supabase) return;
    const { error } = await supabase.rpc("assign_offer", {
      p_offer: id,
      p_report: reportId,
    });
    if (!error) return;
    reportError(errorMessage(error, "No se pudo asignar la ayuda."));
    // Vuelta a la verdad del servidor: el cambio optimista ya no vale.
    try {
      await loadOffers();
    } catch {
      cache = sorted([...cache.filter((o) => o.id !== id), previous]);
      emit();
    }
  })();
}

/**
 * Marks the offer as delivered, or puts it back in play with `false`.
 *
 * Communal like `assignOffer`, and through an RPC for the same reason: whoever
 * coordinated the delivery knows it happened, and the author's anonymous
 * session died with their browser storage long before.
 */
export function setOfferFinished(id: string, finished: boolean): void {
  const previous = cache.find((offer) => offer.id === id);
  if (!previous) return;

  cache = sorted(
    cache.map((offer) =>
      offer.id === id
        ? { ...offer, finishedAt: finished ? new Date().toISOString() : null }
        : offer,
    ),
  );
  emit();

  void (async () => {
    if (!supabase) return;
    const { error } = await supabase.rpc("set_offer_finished", {
      p_offer: id,
      p_finished: finished,
    });
    if (!error) return;
    reportError(errorMessage(error, "No se pudo marcar la ayuda como finalizada."));
    // Vuelta a la verdad del servidor: el cambio optimista ya no vale.
    try {
      await loadOffers();
    } catch {
      cache = sorted([...cache.filter((o) => o.id !== id), previous]);
      emit();
    }
  })();
}

export async function loadOffers(): Promise<void> {
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
    cache = cache.filter((offer) => offer.id !== id);
    emit();
    return;
  }

  if (!isRow(payload.new)) return;
  const offer = fromRow(payload.new);
  cache = sorted([...cache.filter((o) => o.id !== offer.id), offer]);
  emit();
}

bindTable(TABLE, applyRealtime);
