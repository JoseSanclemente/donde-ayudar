import { createClient } from "npm:@supabase/supabase-js@2";

/**
 * The WhatsApp intake for `/mascotas`.
 *
 * Somebody finds a dog, sends the photo they already took to the city's WhatsApp
 * number, and it shows up on the site. This is the only server-side code in the
 * project: it runs on Supabase, not on Netlify, so the site stays static and
 * nothing in the browser ever calls this.
 *
 * The conversation is two steps, because a photo does not say what animal it is:
 *
 *   1. A photo arrives. The intake is recorded — the message id, the sender and
 *      the Graph **media id** — and three buttons go back: Perro / Gato / Otra.
 *   2. The tap arrives. Only now is the photo downloaded, uploaded to the bucket
 *      and published, and the intake deleted.
 *
 * Downloading in step 2 and not in step 1 is the point of the waiting room: a
 * photo nobody classifies never reaches the bucket, so there are no orphan
 * objects to sweep — only rows, and those go below. Meta keeps the media for 30
 * days; a tap arrives in seconds.
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
  other: "Otra",
};

const INTAKE_TTL_HOURS = 24;

const HELP =
  "Manda la foto de la mascota que encontraste y te pregunto qué animal es. " +
  "Sale publicada en donde-ayudar.netlify.app/mascotas.";

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
  if (!(await signatureMatches(raw, request.headers.get("x-hub-signature-256")))) {
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

async function signatureMatches(raw: string, header: string | null): Promise<boolean> {
  if (!header?.startsWith("sha256=")) return false;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(APP_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signed = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(raw)));
  const expected = [...signed].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return constantTimeEquals(expected, header.slice("sha256=".length));
}

/** Comparing with `===` leaks where the first wrong character is. */
function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function handle(payload: Webhook): Promise<void> {
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      // `statuses` — delivered, read — comes through the same webhook and is
      // none of our business.
      for (const message of change.value?.messages ?? []) {
        try {
          await handleMessage(message);
        } catch (error) {
          console.error("whatsapp-pets: message failed", message.id, error);
        }
      }
    }
  }
  await sweepIntakes();
}

async function handleMessage(message: Message): Promise<void> {
  if (message.type === "image" && message.image?.id) {
    await askKind(message, message.image);
    return;
  }

  const button = message.interactive?.button_reply?.id;
  if (button?.startsWith("kind:")) {
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
          "¡Gracias! ¿Qué animal es? Al responder, la foto y este número quedan " +
          "publicados en donde-ayudar.netlify.app/mascotas para que quien la perdió " +
          "te escriba.",
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
/* Step 2 — the tap arrives                                            */
/* ------------------------------------------------------------------ */

async function publish(message: Message, button: string): Promise<void> {
  const [, kind, intakeId] = button.split(":");
  if (!KINDS[kind] || !intakeId) return;

  // Matched on the sender too: the id travels in a button we sent, but a row
  // must never be published under a phone that did not send that photo.
  const { data: intake } = await admin
    .from(INTAKES)
    .select("id, media_id")
    .eq("id", intakeId)
    .eq("wa_from", message.from)
    .maybeSingle();

  // The intake is deleted on publish, so this is what a second tap and a Meta
  // retry both look like.
  if (!intake) {
    await sendText(message.from, "Esa foto ya fue publicada. Gracias.");
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
  const download = await fetch(media.url, { headers: { authorization: `Bearer ${TOKEN}` } });
  if (!download.ok) throw new Error(`media download failed: ${download.status}`);
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
  const uploaded = await admin.storage
    .from(BUCKET)
    .upload(path, bytes, { contentType: media.mime_type });
  if (uploaded.error) throw uploaded.error;

  const inserted = await admin.from(PETS).insert({
    id,
    user_id: BOT_USER_ID,
    kind,
    photo_path: path,
    contact_phone: `+${message.from}`,
  });
  if (inserted.error) {
    await admin.storage.from(BUCKET).remove([path]);
    throw inserted.error;
  }

  await admin.from(INTAKES).delete().eq("id", intake.id);
  await sendText(
    message.from,
    `Listo, ya está publicada en donde-ayudar.netlify.app/mascotas. ` +
      `Quien la perdió te escribirá a este número.`,
  );
}

async function discard(intakeId: string, to: string, reason: string): Promise<void> {
  await admin.from(INTAKES).delete().eq("id", intakeId);
  await sendText(to, reason);
}

/**
 * A photo nobody classified in a day is not going to be classified. Swept on
 * any invocation and not on a schedule: there is no `pg_cron` in this project,
 * the same as the collection points, which expire in the browser.
 */
async function sweepIntakes(): Promise<void> {
  const cutoff = new Date(Date.now() - INTAKE_TTL_HOURS * 3600_000).toISOString();
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

async function send(to: string, message: Record<string, unknown>): Promise<void> {
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
    console.error("whatsapp-pets: send failed", response.status, await response.text());
  }
}

function sendText(to: string, body: string): Promise<void> {
  return send(to, { type: "text", text: { preview_url: false, body } });
}
