/**
 * Publishes a batch of found pets from a JSON file.
 *
 * The site has two writers for `pets` and neither takes a list: the form in the
 * browser publishes one pet at a time under an anonymous session, and the
 * WhatsApp function publishes what a message brought. This is the third, and it
 * is the only one that runs from a terminal: a batch collected off Instagram —
 * an image url, what animal it is, whether it is a male or a female, and the
 * post it appeared in.
 *
 * A batch does not always come off Instagram, so each half of an entry has two
 * shapes and the file picks one of each: the photo is an `image_url` to download
 * or an `image_path` already on disk, and the contact is an `instagram` link —
 * the post the animal appeared in, or the profile of whoever holds the batch —
 * or a `contact_username`, the WhatsApp handle an organization answers at. On top
 * of those, two things only a batch has: the `place_name` of whoever holds the
 * animals, and the `ref_code` each one carries in that place's own register —
 * with one contact for twenty pets, the code is what tells the messages apart.
 *
 * It writes with the `service_role` key, like the WhatsApp function and for the
 * same two reasons: RLS pins `user_id` to the caller's session, and the insert
 * throttle allows four rows a minute per author. Both are right for a browser
 * and neither applies here. The rows are authored by the same bot user the
 * function publishes under, which is what `pets.user_id` needs — the column is
 * NOT NULL and points at `auth.users`.
 *
 * Run:
 *   pnpm pets:seed
 *   pnpm pets:seed -- --dry-run
 *   pnpm pets:seed -- --file scripts/otra-tanda.json
 */

import { readFile, writeFile } from "node:fs/promises";
import { extname } from "node:path";
import { createClient } from "@supabase/supabase-js";

const PHOTO_TYPES = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

const KINDS = ["dog", "cat", "other"];
const SEXES = ["male", "female"];

/** What the CHECK on `pets.contact_instagram_url` takes: a post permalink, or a
 *  profile — the whole address of a batch that came from one institution, where
 *  there is no post per animal. */
const INSTAGRAM_ALLOWED =
  /^https:\/\/(www\.)?instagram\.com\/((p|reel)\/[A-Za-z0-9_-]{5,30}|[A-Za-z0-9._]{1,30})\/?$/;

/**
 * What «copiar enlace» hands over and what gets stored are not the same string.
 * Instagram tacks its own tracking onto every copy — `?utm_source=ig_web_copy_link`,
 * an `igsh` that changes each time — and some links carry the account in front of
 * the code. None of that identifies the post: two copies of the same publication
 * would go in as two different values, and the query string would ride along into
 * the `href` of the button. So the entry is read loosely and only the permalink —
 * or the profile — is kept, which is what the CHECK in the base then demands.
 */
const INSTAGRAM_POST_ANY =
  /^https?:\/\/(?:www\.)?instagram\.com\/(?:[A-Za-z0-9._]+\/)?(p|reel)\/([A-Za-z0-9_-]{5,30})\/?(?:[?#].*)?$/;

const INSTAGRAM_PROFILE_ANY =
  /^https?:\/\/(?:www\.)?instagram\.com\/([A-Za-z0-9._]{1,30})\/?(?:[?#].*)?$/;

function normalizeInstagram(value) {
  const raw = String(value ?? "").trim();

  const post = INSTAGRAM_POST_ANY.exec(raw);
  if (post) return `https://www.instagram.com/${post[1]}/${post[2]}/`;

  const profile = INSTAGRAM_PROFILE_ANY.exec(raw);
  if (profile) return `https://www.instagram.com/${profile[1]}/`;

  return null;
}

const PHONE = /^[0-9+][0-9 ()+-]{6,19}$/;
const WHATSAPP_USERNAME = /^[A-Za-z0-9._-]{3,30}$/;
const REF_CODE = /^[A-Za-z0-9][A-Za-z0-9 _-]{2,39}$/;
const MAX_PLACE_NAME = 120;

const BUCKET = "pets";
const TABLE = "pets";

function parseArgs(argv) {
  const args = { file: "scripts/pets-seed.json", dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--dry-run") args.dryRun = true;
    else if (argv[i] === "--file") {
      args.file = argv[i + 1];
      i += 1;
    }
  }
  if (!args.file) fail("--file needs a path.");
  return args;
}

function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

/**
 * Missing credentials stop the run before anything is touched, the same posture
 * as `headers.mjs`: half a batch published under the wrong identity is worse
 * than a batch that never started.
 */
function required(name) {
  const value = process.env[name];
  if (!value) {
    fail(
      `Falta ${name}. Ponelo en .env (sin commitear) y corré con --env-file=.env.`,
    );
  }
  return value;
}

function validate(entry, index) {
  const where = `entrada ${index + 1}`;

  const hasUrl = typeof entry?.image_url === "string" && entry.image_url;
  const hasPath = typeof entry?.image_path === "string" && entry.image_path;
  if (!hasUrl && !hasPath) return `${where}: falta image_url o image_path.`;
  if (hasUrl && hasPath) {
    return `${where}: image_url e image_path a la vez; la foto es una sola.`;
  }

  if (!KINDS.includes(entry.kind)) {
    return `${where}: kind "${entry.kind}" no es ${KINDS.join(", ")}.`;
  }
  const sex = entry.sex ?? null;
  if (sex !== null && !SEXES.includes(sex)) {
    return `${where}: sex "${sex}" no es male, female ni null.`;
  }

  const wantsInstagram =
    entry.instagram !== undefined && entry.instagram !== null;
  const username = entry.contact_username ?? null;
  const phone = entry.contact_phone ?? null;
  if (!wantsInstagram && username === null && phone === null) {
    return `${where}: falta el contacto (instagram, contact_username o contact_phone).`;
  }
  if (username !== null && !WHATSAPP_USERNAME.test(String(username))) {
    return `${where}: contact_username "${username}" no es un usuario de WhatsApp.`;
  }
  if (phone !== null && !PHONE.test(String(phone))) {
    return `${where}: contact_phone "${phone}" no es un teléfono válido.`;
  }
  if (wantsInstagram) {
    const instagram = normalizeInstagram(entry.instagram);
    if (!instagram) {
      return `${where}: instagram "${entry.instagram}" no es el enlace de una publicación ni de un perfil.`;
    }

    if (!INSTAGRAM_ALLOWED.test(instagram)) {
      return `${where}: "${instagram}" quedó fuera de lo que acepta la base.`;
    }
  }

  const place = entry.place_name ?? null;
  if (place !== null && (!place || String(place).length > MAX_PLACE_NAME)) {
    return `${where}: place_name pasa de ${MAX_PLACE_NAME} caracteres o está vacío.`;
  }
  const ref = entry.ref_code ?? null;
  if (ref !== null && !REF_CODE.test(String(ref))) {
    return `${where}: ref_code "${ref}" quedó fuera de lo que acepta la base.`;
  }
  return null;
}

async function fetchPhoto(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`la foto respondió ${response.status}`);

  const type = (response.headers.get("content-type") ?? "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  const extension = PHOTO_TYPES[type];
  if (!extension) throw new Error(`tipo de foto no admitido: "${type}"`);

  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > MAX_PHOTO_BYTES) {
    throw new Error(
      `la foto pesa ${Math.round(bytes.byteLength / 1024)} KB, el máximo es 5 MB`,
    );
  }

  return { blob: new Blob([bytes], { type }), extension, type };
}

const TYPE_BY_EXTENSION = Object.fromEntries(
  Object.entries(PHOTO_TYPES).map(([type, extension]) => [extension, type]),
);

async function readPhoto(path) {
  const extension = extname(path).replace(".", "").toLowerCase();
  const type = TYPE_BY_EXTENSION[extension === "jpeg" ? "jpg" : extension];
  if (!type) throw new Error(`tipo de foto no admitido: ".${extension}"`);

  const bytes = await readFile(path);
  if (bytes.byteLength > MAX_PHOTO_BYTES) {
    throw new Error(
      `la foto pesa ${Math.round(bytes.byteLength / 1024)} KB, el máximo es 5 MB`,
    );
  }

  return {
    blob: new Blob([bytes], { type }),
    extension: PHOTO_TYPES[type],
    type,
  };
}

/**
 * Photo first, row second, and the object comes back down if the insert fails —
 * the same order as the WhatsApp function, and for the same reason: a pet that
 * never finishes publishing must not leave bytes behind in the bucket.
 */
async function publish(admin, entry, botUserId) {
  const { blob, extension, type } = entry.image_path
    ? await readPhoto(entry.image_path)
    : await fetchPhoto(entry.image_url);

  const id = crypto.randomUUID();
  const path = `${botUserId}/${id}.${extension}`;

  const uploaded = await admin.storage.from(BUCKET).upload(path, blob, {
    contentType: type,
    cacheControl: "31536000",
  });
  if (uploaded.error) throw uploaded.error;

  const inserted = await admin.from(TABLE).insert({
    id,
    user_id: botUserId,
    kind: entry.kind,
    sex: entry.sex ?? null,
    photo_path: path,
    place_name: entry.place_name ?? null,
    ref_code: entry.ref_code ?? null,
    contact_phone: entry.contact_phone ?? null,
    contact_username: entry.contact_username ?? null,
    contact_instagram_url: entry.instagram
      ? normalizeInstagram(entry.instagram)
      : null,
  });
  if (inserted.error) {
    await admin.storage.from(BUCKET).remove([path]);
    throw inserted.error;
  }

  return id;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const url = required("PUBLIC_SUPABASE_URL");
  const serviceKey = required("SUPABASE_SERVICE_ROLE_KEY");
  const botUserId = required("PETS_BOT_USER_ID");

  let entries;
  try {
    entries = JSON.parse(await readFile(args.file, "utf8"));
  } catch (error) {
    fail(`No se pudo leer ${args.file}: ${error.message}`);
  }
  if (!Array.isArray(entries)) fail(`${args.file} tiene que ser un arreglo.`);

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false },
  });

  let published = 0;
  let skipped = 0;
  let failed = 0;

  for (const [index, entry] of entries.entries()) {
    const label = `${index + 1}/${entries.length}`;

    if (entry.id) {
      console.log(`· ${label} ya estaba publicada (${entry.id})`);
      skipped += 1;
      continue;
    }

    const invalid = validate(entry, index);
    if (invalid) {
      console.error(`✗ ${label} ${invalid}`);
      failed += 1;
      continue;
    }

    if (args.dryRun) {
      console.log(`· ${label} lista para publicar (${entry.kind})`);
      continue;
    }

    try {
      entry.id = await publish(admin, entry, botUserId);
      await writeFile(args.file, `${JSON.stringify(entries, null, 2)}\n`);
      console.log(`✓ ${label} publicada (${entry.id})`);
      published += 1;
    } catch (error) {
      console.error(`✗ ${label} ${error.message}`);
      failed += 1;
    }
  }

  console.log(
    args.dryRun
      ? `\nPrueba en seco: ${entries.length - skipped - failed} para publicar, ${skipped} omitidas, ${failed} con error.`
      : `\n${published} publicadas, ${skipped} omitidas, ${failed} con error.`,
  );
  if (failed > 0) process.exit(1);
}

await main();
