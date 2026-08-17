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

  photoPath: string;

  thumbUrl: string;

  photoUrl: string;
  /**
   * Where the animal is, when it is somewhere with a name: a vet, a shelter, an
   * organization. Not an address — whoever recognises their dog needs to know
   * who has it, not the corner it was found on. `null` for everything published
   * from the form or the bot: only maintainer SQL writes this.
   */
  placeName: string | null;
  /**
   * The code this pet carries in the register of whoever handed the batch over
   * (`ROYI-00012`). A whole batch shares one contact, so the code is what tells
   * one message from another: it travels in the `?text=` of the WhatsApp button
   * and in the link that opens this card. `null` for everything published from
   * the form or the bot — only the seeder writes it.
   */
  refCode: string | null;
  /**
   * Which app the button opens, and nothing more: the contact itself is not
   * readable from the browser and arrives one pet at a time. It is what lets the
   * button be painted right the first time instead of guessing WhatsApp and
   * changing its label when the contact lands.
   */
  contactType: PetContactType;
  createdAt: string;
  userId: string;
};

export type PetContactType =
  | "phone"
  | "username"
  | "instagram_post"
  | "instagram_profile";

/**
 * How to write to whoever found a pet, and it is one of the three — never
 * several, never none. WhatsApp lets a person put a username in front of their
 * number, and to whoever receives the message the phone then does not exist: a
 * pet published from the bot by such a sender carries the handle and no phone.
 * `wa.me` opens the chat from either. The third is neither: a pet seeded off
 * Instagram carries the permalink of the post it appeared in.
 *
 * It is not part of `Pet`, and that is the point. The grid reads two hundred
 * rows in one request, and while the contact rode along, so did two hundred
 * phone numbers — the page never painted them, but the response handed them to
 * anyone who asked for the table. The columns are no longer readable from the
 * browser (`supabase/migrations/20260816-mascotas-contacto.sql`); this comes one
 * pet at a time, through `pet_contact`, which is how a card actually uses it.
 */
export type PetContact = {
  phone: string | null;
  username: string | null;
  instagramUrl: string | null;
};

type Row = {
  id: string;
  user_id: string;
  kind: string;
  sex: string | null;
  photo_path: string;
  place_name: string | null;
  ref_code: string | null;
  contact_type?: string | null;
  created_at: string;
};

const TABLE = "pets";
const BUCKET = "pets";

/**
 * Spelled out and never `*`: the three contact columns are not readable with the
 * anon key any more, and `select("*")` asks for every column the table has, so
 * it would come back a permission error instead of a grid.
 */
const COLUMNS =
  "id, user_id, kind, sex, photo_path, place_name, ref_code, contact_type, created_at";

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

export function setPetsState(
  next: StoreState,
  message: string | null = null,
): void {
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

const CONTACT_TYPES: PetContactType[] = [
  "phone",
  "username",
  "instagram_post",
  "instagram_profile",
];

/** A column the base computes, so it is always one of the four. `phone` is the
 *  fallback because it is what the vast majority of pets carry. */
function contactType(value: string | null | undefined): PetContactType {
  const type = value as PetContactType;
  return CONTACT_TYPES.includes(type) ? type : "phone";
}

function fromRow(row: Row): Pet {
  return {
    id: row.id,
    kind: row.kind as PetKind,
    sex: (row.sex as PetSex | null) ?? null,
    photoPath: row.photo_path,
    thumbUrl: photoUrl(row.photo_path, CARD),
    photoUrl: photoUrl(row.photo_path, FULL),
    placeName: row.place_name ?? null,
    refCode: row.ref_code ?? null,
    contactType: contactType(row.contact_type),
    createdAt: row.created_at,
    userId: row.user_id,
  };
}

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

  const path = `${userId}/${id}.${extension}`;

  const uploaded = await supabase.storage
    .from(BUCKET)
    .upload(path, input.file, {
      contentType: input.file.type,
      cacheControl: "31536000",
    });
  if (uploaded.error) {
    reportError("No se pudo subir la foto. Revisa la conexión.");
    return null;
  }

  const local = URL.createObjectURL(input.file);
  const pending: Pet = {
    id,
    kind: input.kind,
    sex: input.sex ?? null,
    photoPath: path,
    thumbUrl: local,
    photoUrl: local,
    placeName: null,
    refCode: null,
    contactType: "phone",
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

    .select(COLUMNS)
    .single();

  if (error || !isRow(data)) {
    dropLocally(id);
    void supabase.storage.from(BUCKET).remove([path]);
    reportError(
      errorMessage(
        error,
        "No se pudo publicar la mascota. Revisa la conexión.",
      ),
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
  contacts.delete(id);
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
      reportError(
        "Solo puedes retirar las mascotas que publicaste en este navegador.",
      );
      return;
    }

    void supabase.storage.from(BUCKET).remove([previous.photoPath]);
  })();
}

export async function loadPets(): Promise<void> {
  if (!supabase) return;
  const { data, error } = await supabase
    .from(TABLE)
    .select(COLUMNS)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  cache = sorted((data ?? []).filter(isRow).map(fromRow));
  emit();
}

/**
 * The contact of one pet, asked for when a card is about to be used and not
 * when the grid is painted.
 *
 * Kept once resolved: the same card is hovered, opened and closed again, and
 * the answer cannot change — there is no UPDATE policy on `pets`. A pet that is
 * deleted takes its entry with it, which is `dropLocally`'s business below.
 *
 * Never throws and never reports: a contact that does not answer leaves the
 * button as it was, and the toast belongs to whoever writes, not to whoever is
 * looking. `null` is «not now», not «this pet has none» — the CHECK in the base
 * demands one of the three.
 */
const contacts = new Map<string, PetContact>();

export function getPetContact(id: string): PetContact | null {
  return contacts.get(id) ?? null;
}

export async function fetchPetContact(id: string): Promise<PetContact | null> {
  const known = contacts.get(id);
  if (known) return known;
  if (!supabase) return null;

  const { data, error } = await supabase.rpc("pet_contact", { p_id: id });
  const row = Array.isArray(data) ? data[0] : null;
  if (error || !row) return null;

  const contact: PetContact = {
    phone: typeof row.contact_phone === "string" ? row.contact_phone : null,
    username:
      typeof row.contact_username === "string" ? row.contact_username : null,
    instagramUrl:
      typeof row.contact_instagram_url === "string"
        ? row.contact_instagram_url
        : null,
  };
  contacts.set(id, contact);
  return contact;
}

function applyRealtime(payload: RealtimePayload): void {
  if (payload.eventType === "DELETE") {
    const id = (payload.old as { id?: string } | null)?.id;
    if (!id) return;
    dropLocally(id);
    return;
  }

  if (!isRow(payload.new)) return;
  const pet = fromRow(payload.new);
  cache = sorted([...cache.filter((p) => p.id !== pet.id), pet]);
  emit();
}

bindTable(TABLE, applyRealtime);
