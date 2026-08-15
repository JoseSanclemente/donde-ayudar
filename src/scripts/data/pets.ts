import { MISSING_ENV_MESSAGE, supabase } from "../supabase";
import { createEmitter } from "./emitter";
import { errorMessage, reportError } from "./errors";
import { bindTable, type RealtimePayload } from "./live";
import { getUserId } from "./session";

/**
 * A pet found in the street: the photo whoever found it already took, a phone,
 * and what kind of animal it is.
 *
 * It is `volunteers` in shape — anyone inserts, everyone reads, only the author
 * withdraws, no communal bit and no RPC — with one difference that changes the
 * whole write path: the photo. It does not live in the row. It goes to the
 * `pets` bucket in Storage and the row keeps its object key, so what travels
 * over realtime is a string and not several megabytes of camera output.
 *
 * That is why `addPet` is `async` and every other `addX` of this folder is not:
 * the path is not known until the upload answers, so there is nothing to put in
 * the cache before it.
 */
export type PetKind = "dog" | "cat" | "other";

/**
 * Whether it is a male or a female — the first thing somebody looking for their
 * dog knows about it. `null` is «no sé», the answer of whoever is looking at an
 * animal in the street and cannot tell, and also what a row published before the
 * question existed carries. Nothing on the page tells the two apart.
 */
export type PetSex = "male" | "female";

export type Pet = {
  id: string;
  kind: PetKind;
  sex: PetSex | null;
  /** The object key inside the bucket — what the row stores. */
  photoPath: string;
  /** The grid card. Not a column: built from `photoPath` on read. */
  thumbUrl: string;
  /** The sheet. Same object, an order of magnitude more bytes. */
  photoUrl: string;
  /**
   * How to write to whoever found it, and it is one of the three — never
   * several, never none. WhatsApp lets a person put a username in front of
   * their number, and to whoever receives the message the phone then does not
   * exist: a pet published from the WhatsApp bot by such a sender carries the
   * handle and no phone. `wa.me` opens the chat from either.
   *
   * The third is neither: a pet seeded off Instagram carries the permalink of
   * the post it appeared in, and the button opens that post.
   */
  contactPhone: string | null;
  contactUsername: string | null;
  contactInstagramUrl: string | null;
  createdAt: string;
  userId: string;
};

type Row = {
  id: string;
  user_id: string;
  kind: string;
  sex: string | null;
  photo_path: string;
  contact_phone: string | null;
  contact_username: string | null;
  contact_instagram_url: string | null;
  created_at: string;
};

const TABLE = "pets";
const BUCKET = "pets";

/** The same ceiling and the same list the bucket enforces, checked here first. */
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
export const PHOTO_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export type StoreState = "loading" | "ready" | "error";

let cache: Pet[] = [];
let state: StoreState = "loading";
let stateMessage: string | null = null;

const changes = createEmitter<Pet[]>();
const states = createEmitter<{ state: StoreState; message: string | null }>();

function emit(): void {
  changes.emit(cache);
}

/** La expone el arranque (`data/boot-pets.ts`) para marcar carga, listo o error. */
export function setPetsState(next: StoreState, message: string | null = null): void {
  state = next;
  stateMessage = message;
  states.emit({ state, message: stateMessage });
}

export function getPetsState(): { state: StoreState; message: string | null } {
  return { state, message: stateMessage };
}

export function onPetsState(
  cb: (state: StoreState, message: string | null) => void,
): () => void {
  return states.on(({ state: next, message }) => cb(next, message));
}

function isRow(value: unknown): value is Row {
  const r = value as Row;
  return (
    !!r &&
    typeof r.id === "string" &&
    typeof r.user_id === "string" &&
    typeof r.kind === "string" &&
    (r.sex === null || r.sex === undefined || typeof r.sex === "string") &&
    typeof r.photo_path === "string" &&
    // One of the three is enough, which is what the CHECK in the base demands:
    // a row with none of them is a pet nobody can ask about.
    (typeof r.contact_phone === "string" ||
      typeof r.contact_username === "string" ||
      typeof r.contact_instagram_url === "string") &&
    typeof r.created_at === "string"
  );
}

/**
 * The two sizes the page asks for. A photo out of WhatsApp is 1200×1600 and a
 * third of a megabyte, which is what the card used to download to paint a square
 * the size of a thumb. Storage resizes on its own url, and serves webp to
 * whoever accepts it, so the row keeps the key and nothing else changes.
 *
 * Both dimensions go on purpose: `width` alone does not preserve the aspect
 * ratio — the default `resize` is `cover` and it honours exactly what it is
 * given, so a lone `width=400` comes back 400×1600.
 */
const CARD = { width: 400, height: 400, resize: "cover", quality: 55 } as const;
const FULL = {
  width: 800,
  height: 800,
  resize: "contain",
  quality: 70,
} as const;

/**
 * The bucket is public, so this is a string built locally — no network and no
 * signed url to expire while somebody is looking at the page.
 */
function photoUrl(path: string, transform: typeof CARD | typeof FULL): string {
  if (!supabase) return "";
  return supabase.storage.from(BUCKET).getPublicUrl(path, { transform }).data
    .publicUrl;
}

function fromRow(row: Row): Pet {
  return {
    id: row.id,
    kind: row.kind as PetKind,
    sex: (row.sex as PetSex | null) ?? null,
    photoPath: row.photo_path,
    thumbUrl: photoUrl(row.photo_path, CARD),
    photoUrl: photoUrl(row.photo_path, FULL),
    contactPhone: row.contact_phone ?? null,
    contactUsername: row.contact_username ?? null,
    contactInstagramUrl: row.contact_instagram_url ?? null,
    createdAt: row.created_at,
    userId: row.user_id,
  };
}

/** Newest first: a pet found this morning is the one being looked for. */
function sorted(pets: Pet[]): Pet[] {
  return [...pets].sort(
    (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
  );
}

export function getPets(): Pet[] {
  return cache;
}

export const onPets = changes.on;

export type PetInput = {
  file: File;
  kind: PetKind;
  /** Optional: whoever picks up a stray does not always know. */
  sex?: PetSex | null;
  contactPhone: string;
};

/**
 * Uploads the photo and then writes the row, in that order and never the other
 * way round: a row pointing at a photo that failed to upload renders broken for
 * everyone forever, while an object with no row is invisible. If the insert is
 * the half that fails, the object is removed before reporting — the safe order
 * is not an excuse to leave it behind.
 *
 * Returns the pet, or `null` when nothing was written.
 */
export async function addPet(input: PetInput): Promise<Pet | null> {
  if (!supabase) {
    reportError(MISSING_ENV_MESSAGE);
    return null;
  }
  const userId = getUserId();
  if (!userId) {
    reportError("Aún no hay sesión. Recarga la página e inténtalo de nuevo.");
    return null;
  }

  const extension = PHOTO_TYPES[input.file.type];
  if (!extension) {
    reportError("La foto tiene que ser JPG, PNG o WEBP.");
    return null;
  }
  if (input.file.size > MAX_PHOTO_BYTES) {
    reportError("La foto pesa más de 5 MB. Tómala de nuevo o redúcela.");
    return null;
  }

  const id = crypto.randomUUID();
  // The uid in front is only for reading the bucket later: what enforces
  // ownership is the `owner` check in the storage policy.
  const path = `${userId}/${id}.${extension}`;

  // The path carries a uuid, so these bytes never change and the object can
  // take whatever cache the CDN grants. Same value the bot writes.
  const uploaded = await supabase.storage.from(BUCKET).upload(path, input.file, {
    contentType: input.file.type,
    cacheControl: "31536000",
  });
  if (uploaded.error) {
    reportError("No se pudo subir la foto. Revisa la conexión.");
    return null;
  }

  // The photo is already up, so the card can be drawn while the row travels.
  // The local url is replaced by the public one as soon as the insert answers.
  // One blob for both sizes: there is nothing to resize on this side.
  const local = URL.createObjectURL(input.file);
  const pending: Pet = {
    id,
    kind: input.kind,
    sex: input.sex ?? null,
    photoPath: path,
    thumbUrl: local,
    photoUrl: local,
    // The form on the site asks for a phone and nothing else: a username can
    // only arrive through the bot, which is what receives the message.
    contactPhone: input.contactPhone,
    contactUsername: null,
    contactInstagramUrl: null,
    createdAt: new Date().toISOString(),
    userId,
  };
  cache = sorted([pending, ...cache]);
  emit();

  const { data, error } = await supabase
    .from(TABLE)
    .insert({
      id,
      user_id: userId,
      kind: input.kind,
      sex: input.sex ?? null,
      photo_path: path,
      contact_phone: input.contactPhone,
    })
    .select()
    .single();

  if (error || !isRow(data)) {
    dropLocally(id);
    void supabase.storage.from(BUCKET).remove([path]);
    reportError(
      errorMessage(error, "No se pudo publicar la mascota. Revisa la conexión."),
    );
    return null;
  }

  const saved = fromRow(data);
  URL.revokeObjectURL(pending.photoUrl);
  cache = sorted([...cache.filter((pet) => pet.id !== saved.id), saved]);
  emit();
  return saved;
}

function dropLocally(id: string): void {
  cache = cache.filter((pet) => pet.id !== id);
  emit();
}

export function removePet(id: string): void {
  const previous = cache.find((pet) => pet.id === id);
  dropLocally(id);
  if (!previous) return;
  void (async () => {
    if (!supabase) return;
    const { error } = await supabase.from(TABLE).delete().eq("id", id);
    if (error) {
      cache = sorted([...cache, previous]);
      emit();
      reportError("Solo puedes retirar las mascotas que publicaste en este navegador.");
      return;
    }
    // The row is what the page reads, so it goes first and the photo after. A
    // failure here leaves an orphan object nobody can reach, which is the
    // cheapest of the two ways this can end badly.
    void supabase.storage.from(BUCKET).remove([previous.photoPath]);
  })();
}

export async function loadPets(): Promise<void> {
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
    cache = cache.filter((pet) => pet.id !== id);
    emit();
    return;
  }

  if (!isRow(payload.new)) return;
  const pet = fromRow(payload.new);
  cache = sorted([...cache.filter((p) => p.id !== pet.id), pet]);
  emit();
}

bindTable(TABLE, applyRealtime);
