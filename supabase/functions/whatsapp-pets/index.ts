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
 *   3. The sex tap arrives. Only now is the photo downloaded, uploaded to the
 *      bucket and published, and the intake deleted.
 *
 * Downloading in the last step and not in the first is the point of the waiting
 * room: a photo nobody finishes classifying never reaches the bucket, so there
 * are no orphan objects to sweep — only rows, and those go below. Meta keeps the
 * media for 30 days; a tap arrives in seconds.
 *
 * The last tap is also where the consent is: it is what publishes a phone
 * number, so both button messages say so.
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

/** `unknown` is a button id and nothing else: it writes NULL on the row. */
const SEXES: Record<string, string> = {
  male: "Macho",
  female: "Hembra",
  unknown: "No sé",
};

const INTAKE_TTL_HOURS = 24;

/** The alphabet of a wamid: `wamid.` and base64. Nothing else reaches a filter. */
const WA_MESSAGE_ID = /^[A-Za-z0-9._=+/-]+$/;

const HELP =
  "Manda la foto de la mascota que encontraste y te hago dos preguntas: qué " +
  "animal es y si es macho o hembra. Sale publicada en " +
  "dondeayudar.com.co/mascotas.";

/* ------------------------------------------------------------------ */
/* The webhook                                                         */
/* ------------------------------------------------------------------ */

type Message = {
  id: string;
  from: string;
  type: string;
  image?: { id: string; mime_type?: string };
  interactive?: { button_reply?: { id: string } };
};

type Webhook = {
  entry?: { changes?: { value?: { messages?: Message[] } }[] }[];
};

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
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      // `statuses` — delivered, read — comes through the same webhook and is
      // none of our business.
      for (const message of change.value?.messages ?? []) {
        handled += 1;
        try {
          await handleMessage(message);
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

async function handleMessage(message: Message): Promise<void> {
  if (message.type === "image" && message.image?.id) {
    await askKind(message, message.image);
    return;
  }

  const button = message.interactive?.button_reply?.id;
  if (button?.startsWith("kind:")) {
    await askSex(message, button);
    return;
  }
  if (button?.startsWith("sex:")) {
    await publish(message, button);
    return;
  }

  await sendText(message.from, HELP);
}

/* ------------------------------------------------------------------ */
/* Step 1 — the photo arrives                                          */
/* ------------------------------------------------------------------ */

async function askKind(
  message: Message,
  image: { id: string; mime_type?: string },
): Promise<void> {
  // `ignoreDuplicates` over the unique `wa_message_id`: a resend of the same
  // message returns no row, and no row means the buttons already went out.
  const { data, error } = await admin
    .from(INTAKES)
    .upsert(
      {
        wa_message_id: message.id,
        wa_from: message.from,
        media_id: image.id,
        mime_type: image.mime_type ?? "",
      },
      { onConflict: "wa_message_id", ignoreDuplicates: true },
    )
    .select("id");

  if (error) throw error;
  const intakeId = data?.[0]?.id;
  if (!intakeId) return;

  await send(message.from, {
    type: "interactive",
    interactive: {
      type: "button",
      body: {
        text:
          "¡Foto recibida! 🙏 ¿Qué animal encontraste?\n\n" +
          "📍 Tu número y esta foto irán a dondeayudar.com.co/mascotas " +
          "para que el dueño te escriba. Toca una opción:",
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

async function askSex(message: Message, button: string): Promise<void> {
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
    .eq("wa_from", message.from)
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
      .eq("wa_from", message.from)
      .maybeSingle();
    if (!intake) {
      await sendText(message.from, "Esa foto ya fue publicada. Gracias.");
    }
    return;
  }

  await send(message.from, {
    type: "interactive",
    interactive: {
      type: "button",
      body: {
        text:
          `Es ${KIND_PHRASES[kind]} ¿Macho o hembra?\n\n` +
          "Con esta respuesta queda publicada.",
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

async function publish(message: Message, button: string): Promise<void> {
  const [, sex, intakeId] = button.split(":");
  if (!SEXES[sex] || !intakeId) return;

  // Matched on the sender too, for the same reason as above.
  const { data: intake } = await admin
    .from(INTAKES)
    .select("id, media_id, kind")
    .eq("id", intakeId)
    .eq("wa_from", message.from)
    .maybeSingle();

  // The intake is deleted on publish, so this is what a second tap and a Meta
  // retry both look like.
  if (!intake) {
    await sendText(message.from, "Esa foto ya fue publicada. Gracias.");
    return;
  }

  // The two questions arrived out of order, which no button of ours can do.
  if (!intake.kind || !KINDS[intake.kind]) {
    await sendText(message.from, HELP);
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
      message.from,
      "La foto tiene que ser JPG, PNG o WEBP. Mándala de nuevo, por favor.",
    );
    return;
  }
  if ((media.file_size ?? 0) > MAX_PHOTO_BYTES) {
    await discard(
      intake.id,
      message.from,
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
    contact_phone: `+${message.from}`,
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
      message.from,
      "¡Listo! 🐾 Ya está publicada en dondeayudar.com.co/mascotas. " +
        "Si la familia la está buscando, te escribirán directamente a este " +
        "número. ¡Gracias por tu ayuda!",
    ),
  ]);
}

async function discard(
  intakeId: string,
  to: string,
  reason: string,
): Promise<void> {
  await admin.from(INTAKES).delete().eq("id", intakeId);
  await sendText(to, reason);
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

async function send(
  to: string,
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
      to,
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

function sendText(to: string, body: string): Promise<void> {
  return send(to, { type: "text", text: { preview_url: false, body } });
}
