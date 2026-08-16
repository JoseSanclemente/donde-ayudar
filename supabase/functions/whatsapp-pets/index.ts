import { createClient } from "npm:@supabase/supabase-js@2";

/**
 * The WhatsApp intake for `/mascotas`.
 *
 * Somebody finds a dog, sends the photo they already took to the city's WhatsApp
 * number, and it shows up on the site. This is the only server-side code in the
 * project: it runs on Supabase, not on Netlify, so the site stays static and
 * nothing in the browser ever calls this.
 *
 * The conversation is three steps, because a photo does not say what animal it
 * is, and a WhatsApp message carries three buttons at most:
 *
 *   1. A photo arrives. The intake is recorded — the message id, the sender and
 *      the Graph **media id** — and three buttons go back: Perro / Gato / Otro.
 *   2. The kind tap arrives. It is saved on the intake and three more buttons go
 *      back: Macho / Hembra / No sé.
 *   3. The sex tap arrives. It is saved too, and for whoever has answered the
 *      consent question before, this is where the photo is downloaded, uploaded
 *      to the bucket and published, and the intake deleted.
 *
 * And a fourth step the first time, and only the first time:
 *
 *   4. Publishing the photo publishes the way back to whoever sent it — their
 *      number, or their username when the number is hidden behind one. That used
 *      to be announced in step 1 and taken as accepted by the tap in step 3.
 *      Announcing is not asking. So a sender we have no answer from is asked
 *      outright, with two buttons, and it is that tap that publishes. The answer
 *      goes to `pet_senders` and is never asked again: the second photo of
 *      somebody who said yes still takes three taps.
 *
 * A no is not a publication without a contact — the CHECK in the schema wants
 * one of the three and a photo nobody can be written about is a photo nobody can
 * claim. It is the photo discarded, and said so.
 *
 * Downloading in the last step and not in the first is the point of the waiting
 * room: a photo nobody finishes classifying never reaches the bucket, so there
 * are no orphan objects to sweep — only rows, and those go below. Meta keeps the
 * media for 30 days; a tap arrives in seconds.
 */

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

const GRAPH = "https://graph.facebook.com/v23.0";

/** Loud on boot: a missing secret is a webhook that answers 500 to everything,
 *  which is far easier to find than one that publishes nothing in silence. */
function required(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`missing secret: ${name}`);
  return value;
}

const VERIFY_TOKEN = required("WHATSAPP_VERIFY_TOKEN");
const APP_SECRET = required("WHATSAPP_APP_SECRET");
const TOKEN = required("WHATSAPP_TOKEN");
const PHONE_NUMBER_ID = required("WHATSAPP_PHONE_NUMBER_ID");
/** The author every published row carries. There is no `auth.uid()` here. */
const BOT_USER_ID = required("PETS_BOT_USER_ID");

const admin = createClient(
  required("SUPABASE_URL"),
  required("SUPABASE_SERVICE_ROLE_KEY"),
  { auth: { persistSession: false } },
);

const BUCKET = "pets";
const INTAKES = "pet_intakes";
const SENDERS = "pet_senders";
const PETS = "pets";

/** The same ceiling and the same list the bucket enforces, checked here first. */
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const PHOTO_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

const KINDS: Record<string, string> = {
  dog: "Perro",
  cat: "Gato",
  other: "Otro",
};

/** The article the second question needs: «Un perro» / «Una mascota». */
const KIND_PHRASES: Record<string, string> = {
  dog: "un perro 🐶",
  cat: "un gato 🐱",
  other: "una mascota 🐾",
};

/** `unknown` is stored as it is typed here and becomes NULL on the published
 *  row: on the intake it has to be told apart from «has not answered yet». */
const SEXES: Record<string, string> = {
  male: "Macho",
  female: "Hembra",
  unknown: "No sé",
};

/** Two and not three: the question has two answers and a third button would
 *  only be a way of not answering it. */
const CONSENTS: Record<string, string> = {
  yes: "Sí, publicar",
  no: "No",
};

const INTAKE_TTL_HOURS = 24;

/** The alphabet of a wamid: `wamid.` and base64. Nothing else reaches a filter. */
const WA_MESSAGE_ID = /^[A-Za-z0-9._=+/-]+$/;

const HELP =
  "Hola. Para reportar una mascota encontrada, envíanos solamente una foto 📸 " +
  "(sin texto, ni audios). En el siguiente paso te pediremos los detalles.";

/**
 * Whoever writes does not know this number only reads a photo, so they write
 * three lines, or they keep typing with the buttons already on screen. Every one
 * of those falls through to the same reply, and answering each of them is how one
 * misunderstanding becomes five identical messages. Only the fallthrough is held
 * back — a photo and a tap are never skipped.
 *
 * The window is kept in the isolate and not in a table: a burst arrives in
 * seconds, the isolate outlives that by minutes, and the only cost of a cold
 * start is one extra reply, which is what happens today anyway. A `wa_nudges`
 * table would be exact, and it would be a schema, a sweep and a round trip for a
 * duplicate text message.
 */
const NUDGE_WINDOW_MS = 60_000;
const lastNudge = new Map<string, number>();

/* ------------------------------------------------------------------ */
/* The webhook                                                         */
/* ------------------------------------------------------------------ */

type Message = {
  id: string;
  /** Absent when the sender hides their phone behind a WhatsApp username. */
  from?: string;
  from_user_id?: string;
  type: string;
  image?: { id: string; mime_type?: string };
  interactive?: { button_reply?: { id: string } };
};

type Contact = {
  profile?: { name?: string; username?: string };
  wa_id?: string;
  user_id?: string;
};

type Value = { messages?: Message[]; contacts?: Contact[] };

type Webhook = {
  entry?: { changes?: { value?: Value }[] }[];
};

/**
 * Who to answer, and what will be published as their contact.
 *
 * A WhatsApp username hides the phone: `from` and `wa_id` simply are not in the
 * payload, and what comes instead is a business-scoped user id — `CO.13511…`,
 * stable for this business and useless to anyone else. Meta only puts the phone
 * back if the number wrote to us, or we to it, in the last 30 days; for whoever
 * writes for the first time from a username there is never a phone to have.
 *
 * So the sender is one of two things and the whole function has to carry both:
 * the address is what `send` addresses and what `pet_intakes` matches on, and
 * `username` is the only contact a published row can offer when there is no
 * phone. `wa.me/<username>` opens that chat, which is what the card needs.
 */
type Sender = {
  /** The digits, or the business-scoped user id. */
  address: string;
  /** Whether that address is a user id and not a phone. */
  scoped: boolean;
  username: string | null;
};

/** `CO.1351106690554399` — a country prefix, a period and digits. */
const USER_ID = /^[A-Z]{2}\.\d+$/;

function senderOf(message: Message, contacts?: Contact[]): Sender | null {
  const address = message.from ?? message.from_user_id;
  if (!address) return null;
  return {
    address,
    scoped: !message.from && USER_ID.test(address),
    username: contacts?.[0]?.profile?.username ?? null,
  };
}

Deno.serve(async (request) => {
  const url = new URL(request.url);

  // The subscription handshake. Meta sends it once when the callback url is
  // saved, and again whenever the subscription is re-verified.
  if (request.method === "GET") {
    const ok =
      url.searchParams.get("hub.mode") === "subscribe" &&
      url.searchParams.get("hub.verify_token") === VERIFY_TOKEN;
    if (!ok) return new Response("forbidden", { status: 403 });
    return new Response(url.searchParams.get("hub.challenge") ?? "", {
      headers: { "content-type": "text/plain" },
    });
  }

  if (request.method !== "POST") {
    return new Response("method not allowed", { status: 405 });
  }

  // The body is read as text and verified before it is parsed: this endpoint is
  // public — it has to be, Meta sends no `Authorization` header — and the
  // signature is the whole of what says the payload came from Meta. Without it
  // anyone who learns the url can publish a pet.
  const raw = await request.text();
  if (
    !(await signatureMatches(raw, request.headers.get("x-hub-signature-256")))
  ) {
    return new Response("bad signature", { status: 401 });
  }

  let payload: Webhook;
  try {
    payload = JSON.parse(raw) as Webhook;
  } catch {
    return new Response("bad body", { status: 400 });
  }

  // Answer now and work after: Meta gives a webhook a handful of seconds and
  // resends anything slower, and downloading several megabytes and uploading
  // them again does not fit in that. A retry we would only answer with a
  // duplicate.
  EdgeRuntime.waitUntil(handle(payload));
  return new Response("ok");
});

async function signatureMatches(
  raw: string,
  header: string | null,
): Promise<boolean> {
  if (!header?.startsWith("sha256=")) return false;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(APP_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signed = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, encoder.encode(raw)),
  );
  const expected = [...signed]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return constantTimeEquals(expected, header.slice("sha256=".length));
}

/** Comparing with `===` leaks where the first wrong character is. */
function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1)
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function handle(payload: Webhook): Promise<void> {
  let handled = 0;
  // A photo and two lines of text can arrive in a single payload. The senders
  // already answered here do not get answered again.
  const nudged = new Set<string>();
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      // `statuses` — delivered, read — comes through the same webhook and is
      // none of our business.
      for (const message of change.value?.messages ?? []) {
        handled += 1;
        try {
          await handleMessage(message, change.value?.contacts, nudged);
        } catch (error) {
          console.error("whatsapp-pets: message failed", message.id, error);
        }
      }
    }
  }
  // Those `statuses` deliveries are around half the invocations, and sweeping on
  // one is a delete over a table nothing has written to since the last sweep.
  if (handled > 0) await sweepIntakes();
}

async function handleMessage(
  message: Message,
  contacts: Contact[] | undefined,
  nudged: Set<string>,
): Promise<void> {
  // Nobody to answer and nothing to attribute a photo to. Meta always sends one
  // of the two, so this is a shape we do not know rather than a message we can
  // reply to badly.
  const sender = senderOf(message, contacts);
  if (!sender) {
    console.error("whatsapp-pets: message with no sender", message.id);
    return;
  }

  if (message.type === "image" && message.image?.id) {
    await askKind(message, sender, message.image);
    return;
  }

  const button = message.interactive?.button_reply?.id;
  if (button?.startsWith("kind:")) {
    await askSex(message, sender, button);
    return;
  }
  if (button?.startsWith("sex:")) {
    await onSex(message, sender, button);
    return;
  }
  if (button?.startsWith("ok:")) {
    await onConsent(message, sender, button);
    return;
  }

  await nudge(sender, nudged);
}

/**
 * The reply for everything that is neither a photo nor a tap: a greeting, the
 * description of the dog, an audio, a sticker. What it says depends on where the
 * sender already is, because telling somebody to send a photo while their photo
 * waits for a tap reads as if the conversation had been lost.
 */
async function nudge(sender: Sender, nudged: Set<string>): Promise<void> {
  if (nudged.has(sender.address)) return;
  nudged.add(sender.address);

  const now = Date.now();
  for (const [address, at] of lastNudge) {
    if (now - at > NUDGE_WINDOW_MS) lastNudge.delete(address);
  }
  if (now - (lastNudge.get(sender.address) ?? 0) < NUDGE_WINDOW_MS) return;
  lastNudge.set(sender.address, now);

  // The last one, because that is the conversation the buttons on their screen
  // belong to.
  const { data: intake } = await admin
    .from(INTAKES)
    .select("kind, sex")
    .eq("wa_from", sender.address)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!intake) {
    await sendText(sender, HELP);
    return;
  }
  if (intake.sex) {
    await sendText(
      sender,
      "Falta una sola respuesta: toca «Sí, publicar» o «No» en el mensaje de " +
        "arriba.",
    );
    return;
  }
  await sendText(
    sender,
    intake.kind
      ? "Ya casi. Toca «Macho», «Hembra» o «No sé» en el mensaje de arriba."
      : "Ya recibimos tu foto 📸 Toca una de las opciones de arriba " +
        "(Perro / Gato / Otro) para publicarla.",
  );
}

/* ------------------------------------------------------------------ */
/* Who already answered the consent question                           */
/* ------------------------------------------------------------------ */

/**
 * `true` they agreed, `false` they refused, `null` they were never asked.
 *
 * The three are not the same and only the first skips the question. A stored no
 * is asked again rather than silently refused: somebody who said no once and
 * sends a photo months later is not asking us to throw it away without a word,
 * and the alternative is a person whose photos die in silence forever.
 */
async function consentOf(address: string): Promise<boolean | null> {
  const { data } = await admin
    .from(SENDERS)
    .select("consented")
    .eq("wa_from", address)
    .maybeSingle();
  return data?.consented ?? null;
}

async function rememberConsent(
  address: string,
  consented: boolean,
): Promise<void> {
  const { error } = await admin
    .from(SENDERS)
    .upsert(
      { wa_from: address, consented, decided_at: new Date().toISOString() },
      { onConflict: "wa_from" },
    );
  if (error) throw error;
}

/* ------------------------------------------------------------------ */
/* Step 1 — the photo arrives                                          */
/* ------------------------------------------------------------------ */

async function askKind(
  message: Message,
  sender: Sender,
  image: { id: string; mime_type?: string },
): Promise<void> {
  // `ignoreDuplicates` over the unique `wa_message_id`: a resend of the same
  // message returns no row, and no row means the buttons already went out.
  //
  // The username is kept here and not read again at the last step: the contacts
  // array travels with every message, but what a photo is published under should
  // be what was true when the photo arrived.
  const { data, error } = await admin
    .from(INTAKES)
    .upsert(
      {
        wa_message_id: message.id,
        wa_from: sender.address,
        wa_username: sender.username,
        media_id: image.id,
        mime_type: image.mime_type ?? "",
      },
      { onConflict: "wa_message_id", ignoreDuplicates: true },
    )
    .select("id");

  if (error) throw error;
  const intakeId = data?.[0]?.id;
  if (!intakeId) return;

  // Somebody sending four shots of the same dog gets four cards and, if they tap
  // through all of them, four pets. That is left alone — whoever really found two
  // animals is served by exactly the same behaviour — but it is said out loud,
  // because a surprise and a choice are not the same thing.
  const { count } = await admin
    .from(INTAKES)
    .select("id", { count: "exact", head: true })
    .eq("wa_from", sender.address)
    .neq("id", intakeId);

  await send(sender, {
    type: "interactive",
    interactive: {
      type: "button",
      body: {
        text:
          "¡Foto recibida! 🙏 ¿Qué animal encontraste?\n\n" +
          `📍 ${sender.scoped ? "Tu usuario" : "Tu número"} y esta foto irán a ` +
          "dondeayudar.com.co/mascotas para que el dueño te escriba. " +
          "Toca una opción:" +
          ((count ?? 0) > 0
            ? "\n\nNota: cada foto se publica por separado. Si son varias fotos " +
              "de la misma mascota, responde solo esta."
            : ""),
      },
      action: {
        buttons: Object.entries(KINDS).map(([kind, title]) => ({
          type: "reply",
          reply: { id: `kind:${kind}:${intakeId}`, title },
        })),
      },
    },
  });
}

/* ------------------------------------------------------------------ */
/* Step 2 — the kind tap arrives                                       */
/* ------------------------------------------------------------------ */

async function askSex(
  message: Message,
  sender: Sender,
  button: string,
): Promise<void> {
  const [, kind, intakeId] = button.split(":");
  if (!KINDS[kind] || !intakeId) return;
  // The id goes inside a PostgREST filter string below, so it is checked against
  // the alphabet a wamid is made of before it gets there. The payload is
  // signature-verified, but a filter built out of input is not something to
  // leave to the signature.
  if (!WA_MESSAGE_ID.test(message.id)) return;

  // One round trip, not two: the filter says everything the old select checked
  // afterwards. Matched on the sender — the id travels in a button we sent, but
  // a photo must never be classified under a phone that did not send it — and on
  // `wa_kind_message_id`, so a Meta resend of the same tap matches no row. A tap
  // on a *different* button does match: the person changed their mind before
  // answering the second question, and the last word is theirs.
  const { data: updated, error } = await admin
    .from(INTAKES)
    .update({ kind, wa_kind_message_id: message.id })
    .eq("id", intakeId)
    .eq("wa_from", sender.address)
    .or(`wa_kind_message_id.is.null,wa_kind_message_id.neq."${message.id}"`)
    .select("id")
    .maybeSingle();
  if (error) throw error;

  // No row means one of two things, and they do not read the same to whoever
  // tapped: the intake is gone —deleted on publish, so this is a tap on the
  // buttons of an already published photo— or it is the resend. Only this
  // branch, the rare one, pays a second round trip to tell them apart.
  if (!updated) {
    const { data: intake } = await admin
      .from(INTAKES)
      .select("id")
      .eq("id", intakeId)
      .eq("wa_from", sender.address)
      .maybeSingle();
    if (!intake) {
      await sendText(sender, "Esa foto ya fue publicada. Gracias.");
    }
    return;
  }

  // Whether this is the last question depends on whether we already have an
  // answer to the fourth one, and saying «queda publicada» to somebody who is
  // about to be asked one more thing is a promise the next message breaks.
  const consented = await consentOf(sender.address);

  await send(sender, {
    type: "interactive",
    interactive: {
      type: "button",
      body: {
        text:
          `Es ${KIND_PHRASES[kind]} ¿Macho o hembra?\n\n` +
          (consented === true
            ? "Con esta respuesta queda publicada."
            : "Después te hacemos una última pregunta."),
      },
      action: {
        buttons: Object.entries(SEXES).map(([sex, title]) => ({
          type: "reply",
          reply: { id: `sex:${sex}:${intakeId}`, title },
        })),
      },
    },
  });
}

/* ------------------------------------------------------------------ */
/* Step 3 — the sex tap arrives                                        */
/* ------------------------------------------------------------------ */

/** Everything publishing needs off the waiting room. */
type Intake = {
  id: string;
  media_id: string;
  kind: string | null;
  sex: string | null;
  wa_username: string | null;
};

const INTAKE_COLUMNS = "id, media_id, kind, sex, wa_username";

/**
 * For whoever has already said yes this is the last tap and it publishes. For
 * everybody else it is the second-to-last: the answer is written down and the
 * consent question goes out.
 */
async function onSex(
  message: Message,
  sender: Sender,
  button: string,
): Promise<void> {
  const [, sex, intakeId] = button.split(":");
  if (!SEXES[sex] || !intakeId) return;
  if (!WA_MESSAGE_ID.test(message.id)) return;

  // The same shape as the kind tap, and now for the same reason: between this
  // answer and the publication there can be another wait, so a resend of this
  // tap must not send the consent buttons twice while a genuine correction must.
  const { data: intake, error } = await admin
    .from(INTAKES)
    .update({ sex, wa_sex_message_id: message.id })
    .eq("id", intakeId)
    .eq("wa_from", sender.address)
    .or(`wa_sex_message_id.is.null,wa_sex_message_id.neq."${message.id}"`)
    .select(INTAKE_COLUMNS)
    .maybeSingle();
  if (error) throw error;

  if (!intake) {
    const { data: known } = await admin
      .from(INTAKES)
      .select("id")
      .eq("id", intakeId)
      .eq("wa_from", sender.address)
      .maybeSingle();
    if (!known) await sendText(sender, "Esa foto ya fue publicada. Gracias.");
    return;
  }

  // The two questions arrived out of order, which no button of ours can do.
  if (!intake.kind || !KINDS[intake.kind]) {
    await sendText(sender, HELP);
    return;
  }

  if ((await consentOf(sender.address)) === true) {
    await publishPet(sender, intake as Intake);
    return;
  }
  await askConsent(sender, intake.id);
}

/* ------------------------------------------------------------------ */
/* Step 4 — the consent question, the first time only                  */
/* ------------------------------------------------------------------ */

/**
 * What is actually being asked, named plainly: the photo is not the sensitive
 * half, the way back to whoever sent it is. Which of the two it will be depends
 * on the sender, so the question says the one that applies rather than covering
 * both and leaving them to work out which is theirs.
 */
async function askConsent(sender: Sender, intakeId: string): Promise<void> {
  const what = sender.scoped ? "tu usuario de WhatsApp" : "tu número de WhatsApp";
  await send(sender, {
    type: "interactive",
    interactive: {
      type: "button",
      body: {
        text:
          "Una última cosa 🙏 Para que la familia pueda reclamarla, junto a la " +
          `foto publicamos ${what} en dondeayudar.com.co/mascotas. Es la única ` +
          "forma de que te escriban.\n\n" +
          "¿Nos autorizas a publicarlo? Solo te lo preguntamos esta vez.",
      },
      action: {
        buttons: Object.entries(CONSENTS).map(([answer, title]) => ({
          type: "reply",
          reply: { id: `ok:${answer}:${intakeId}`, title },
        })),
      },
    },
  });
}

async function onConsent(
  message: Message,
  sender: Sender,
  button: string,
): Promise<void> {
  const [, answer, intakeId] = button.split(":");
  if (!CONSENTS[answer] || !intakeId) return;

  const { data: intake } = await admin
    .from(INTAKES)
    .select(INTAKE_COLUMNS)
    .eq("id", intakeId)
    .eq("wa_from", sender.address)
    .maybeSingle();

  // The intake is deleted on publish and on a no, so this is what a second tap
  // and a Meta retry both look like.
  if (!intake) {
    await sendText(sender, "Esa foto ya fue publicada. Gracias.");
    return;
  }

  // Written down before it is acted on, and in its own round trip: what must
  // never happen is a photo published under a yes that was not recorded.
  await rememberConsent(sender.address, answer === "yes");

  if (answer === "no") {
    await discard(
      intake.id,
      sender,
      "Listo, no publicamos nada y descartamos la foto 👍 Si cambias de " +
        "opinión, mándala otra vez cuando quieras. ¡Gracias igual!",
    );
    return;
  }

  // Neither of these can happen through a button of ours, and publishing needs
  // both: the kind is a column with a CHECK and the sex is what step 3 saved.
  if (!intake.kind || !KINDS[intake.kind] || !intake.sex) {
    await sendText(sender, HELP);
    return;
  }

  await publishPet(sender, intake as Intake);
}

/* ------------------------------------------------------------------ */
/* Publishing                                                          */
/* ------------------------------------------------------------------ */

async function publishPet(sender: Sender, intake: Intake): Promise<void> {
  const sex = intake.sex ?? "unknown";

  // The contact the card will carry. A scoped sender has no phone anywhere in
  // the payload — that is what the username is for — so with neither there is
  // nothing to publish: a photo with no way back is a photo nobody can claim.
  const username = sender.username ?? intake.wa_username ?? null;
  if (sender.scoped && !username) {
    await discard(
      intake.id,
      sender,
      "No pudimos leer un contacto para publicar la foto. " +
        "Escríbenos desde un número de WhatsApp, por favor.",
    );
    return;
  }

  const media = (await graph(`/${intake.media_id}`)) as {
    url?: string;
    mime_type?: string;
    file_size?: number;
  };

  const extension = PHOTO_TYPES[media.mime_type ?? ""];
  if (!media.url || !extension) {
    await discard(
      intake.id,
      sender,
      "La foto tiene que ser JPG, PNG o WEBP. Mándala de nuevo, por favor.",
    );
    return;
  }
  if ((media.file_size ?? 0) > MAX_PHOTO_BYTES) {
    await discard(
      intake.id,
      sender,
      "La foto pesa más de 5 MB. Tómala de nuevo o redúcela, por favor.",
    );
    return;
  }

  // The media url is not public: it wants the same bearer token.
  const download = await fetch(media.url, {
    headers: { authorization: `Bearer ${TOKEN}` },
  });
  if (!download.ok)
    throw new Error(`media download failed: ${download.status}`);
  const bytes = await download.blob();

  const id = crypto.randomUUID();
  // The uid in front is only for reading the bucket later, the same shape
  // `src/scripts/data/pets.ts` writes. These objects have no `owner` — nobody
  // uploaded them from a browser — so no client policy can ever remove them;
  // taking one down is the maintainer SQL in `supabase/README.md`.
  const path = `${BOT_USER_ID}/${id}.${extension}`;

  // Photo first, row second, and the object removed if the insert fails: the
  // order `data/pets.ts` documents, for the same reason. A row pointing at a
  // photo that never uploaded renders broken for everyone forever; an object
  // with no row is invisible.
  // The path carries a uuid, so these bytes never change: whatever cache the
  // CDN is willing to grant, this object can take. What the page actually reads
  // is the transform endpoint, which pins an hour of its own regardless.
  const uploaded = await admin.storage
    .from(BUCKET)
    .upload(path, bytes, {
      contentType: media.mime_type,
      cacheControl: "31536000",
    });
  if (uploaded.error) throw uploaded.error;

  const inserted = await admin.from(PETS).insert({
    id,
    user_id: BOT_USER_ID,
    kind: intake.kind,
    // «No sé» is an answer, and the column has no value for it: it is stored as
    // null, the same as a row published before the question existed.
    sex: sex === "unknown" ? null : sex,
    photo_path: path,
    // One of the two, never both: the phone when there is one, the username when
    // the phone is hidden. The CHECK in the schema demands exactly that.
    contact_phone: sender.scoped ? null : `+${sender.address}`,
    contact_username: sender.scoped ? username : null,
  });
  if (inserted.error) {
    await admin.storage.from(BUCKET).remove([path]);
    throw inserted.error;
  }

  // Both at once: the row is already published, so emptying the waiting room is
  // no reason to keep whoever sent the photo waiting for the confirmation.
  await Promise.all([
    admin.from(INTAKES).delete().eq("id", intake.id),
    sendText(
      sender,
      "¡Listo! 🐾 Ya está publicada en dondeayudar.com.co/mascotas. " +
        "Si la familia la está buscando, te escribirán directamente por " +
        "acá. ¡Gracias por tu ayuda!",
    ),
  ]);
}

async function discard(
  intakeId: string,
  sender: Sender,
  reason: string,
): Promise<void> {
  await admin.from(INTAKES).delete().eq("id", intakeId);
  await sendText(sender, reason);
}

/**
 * A photo nobody classified in a day is not going to be classified. Swept on any
 * invocation that carried a message and not on a schedule: there is no `pg_cron`
 * in this project, the same as the collection points, which expire in the
 * browser. The `statuses` deliveries are skipped — nothing has been written to
 * this table since the last sweep on one of those.
 */
async function sweepIntakes(): Promise<void> {
  const cutoff = new Date(
    Date.now() - INTAKE_TTL_HOURS * 3600_000,
  ).toISOString();
  const { error } = await admin.from(INTAKES).delete().lt("created_at", cutoff);
  if (error) console.error("whatsapp-pets: sweep failed", error);
}

/* ------------------------------------------------------------------ */
/* Graph                                                               */
/* ------------------------------------------------------------------ */

async function graph(path: string): Promise<unknown> {
  const response = await fetch(`${GRAPH}${path}`, {
    headers: { authorization: `Bearer ${TOKEN}` },
  });
  if (!response.ok) throw new Error(`graph ${path} failed: ${response.status}`);
  return await response.json();
}

/**
 * `to` takes a phone and `recipient` takes a business-scoped user id, and they
 * are not interchangeable: sending both makes Meta use `to` and ignore the
 * other, so whichever one this sender is, only that key goes out.
 */
async function send(
  sender: Sender,
  message: Record<string, unknown>,
): Promise<void> {
  const response = await fetch(`${GRAPH}/${PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${TOKEN}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      ...(sender.scoped ? { recipient: sender.address } : { to: sender.address }),
      ...message,
    }),
  });
  // A reply that does not arrive is not a reason to undo a published pet.
  if (!response.ok) {
    console.error(
      "whatsapp-pets: send failed",
      response.status,
      await response.text(),
    );
  }
}

function sendText(sender: Sender, body: string): Promise<void> {
  return send(sender, { type: "text", text: { preview_url: false, body } });
}
