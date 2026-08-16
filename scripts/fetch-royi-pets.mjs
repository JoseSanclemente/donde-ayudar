/**
 * Reads the found pets Royi publishes on their own site and leaves them ready
 * for `seed-pets.mjs`.
 *
 * https://royipets.netlify.app is a static page over Firebase Firestore, and its
 * `pets` collection is world-readable with the web API key the page itself ships
 * in its HTML — so this asks the REST API for the documents instead of scraping
 * rendered markup. Nothing here writes anywhere: it downloads, it filters, and
 * it writes a JSON file and a folder of photos. Publishing is the seeder's job,
 * and it runs separately and with credentials this one does not need.
 *
 * The photos are not files over there either: each pet keeps a small `thumb` and
 * the full picture lives in a second collection, `fotos/{code}.imgs[]`, as a
 * base64 data url. What comes out of here is a jpeg per pet on disk.
 *
 * Run:
 *   pnpm pets:royi
 *   pnpm pets:royi -- --username otra.cuenta --place "Otra Fundación"
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/** The project and the key are the ones in the page's own `firebase.initializeApp`. */
const PROJECT = "royi-pets";
const API_KEY = "";
const FIRESTORE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;

/** Who answers for every animal in this batch, and how to write to them. */
const PLACE_NAME = "Royi Pets";
const CONTACT_USERNAME = "lore.sant1ago";

const OUT_FILE = "scripts/pets-royi.json";
const PHOTOS_DIR = "scripts/.royi-photos";

/** Un animal que ya tiene con quién quedarse no es al que alguien está buscando. */
const CLOSED_STATES = ["Adoptado", "Encontró sus dueños"];
/**
 * Y dónde está dice lo mismo por otro lado. No sobra: hay filas con `estado`
 * «Disponible» y `ubicacion` «Adoptado», y entre las dos gana la que cierra.
 */
const CLOSED_PLACES = ["Adoptado", "Con sus dueños"];

/**
 * Este sitio es de Cali. Royi también recibe animales de fuera —el sector dice
 * «Jamundí» en dos filas— y publicarlos acá los pone en una cuadrícula que quien
 * los busca no va a mirar.
 */
const CITY = "cali";

/**
 * Segunda guarda, y solo avisa: `lugarDireccion` es texto libre y a veces nombra
 * el municipio («Terranova - Jamundi») con el sector todavía en Cali. No se
 * descarta solo porque un barrio puede llamarse igual que un pueblo.
 */
const NEARBY_TOWNS = [
  "jamundi",
  "yumbo",
  "palmira",
  "puerto tejada",
  "candelaria",
  "dagua",
  "la cumbre",
];

const KINDS = { Perro: "dog", Gato: "cat" };
const SEXES = { Macho: "male", Hembra: "female" };

function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = {
    file: OUT_FILE,
    photos: PHOTOS_DIR,
    place: PLACE_NAME,
    username: CONTACT_USERNAME,
  };
  const flags = {
    "--out": "file",
    "--photos": "photos",
    "--place": "place",
    "--username": "username",
  };
  for (let i = 0; i < argv.length; i += 1) {
    const key = flags[argv[i]];
    if (!key) fail(`Opción desconocida: ${argv[i]}`);
    if (!argv[i + 1]) fail(`${argv[i]} necesita un valor.`);
    args[key] = argv[i + 1];
    i += 1;
  }
  return args;
}

/** Un valor de Firestore viene envuelto en el nombre de su tipo. */
function value(field) {
  if (!field) return null;
  const [kind, raw] = Object.entries(field)[0];
  if (kind === "nullValue") return null;
  if (kind === "arrayValue") return (raw.values ?? []).map(value);
  if (kind === "mapValue") {
    return Object.fromEntries(
      Object.entries(raw.fields ?? {}).map(([k, v]) => [k, value(v)]),
    );
  }
  return raw;
}

function field(doc, name) {
  return value(doc.fields?.[name]);
}

/** Sin tildes y en minúscula: «JAMUNDÍ» y «Jamundi» son el mismo pueblo. */
function normalize(text) {
  return String(text ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url.split("?")[0]} respondió ${response.status}`);
  }
  return response.json();
}

async function fetchPets() {
  const docs = [];
  let token = null;
  do {
    const url = `${FIRESTORE}/pets?pageSize=300&key=${API_KEY}${
      token ? `&pageToken=${token}` : ""
    }`;
    const page = await fetchJson(url);
    docs.push(...(page.documents ?? []));
    token = page.nextPageToken ?? null;
  } while (token);
  return docs;
}

/** Por qué esta mascota no entra, o `null` si entra. */
function rejection(doc) {
  if (field(doc, "archivado")) return "archivada";
  const state = field(doc, "estado");
  if (CLOSED_STATES.includes(state)) return `estado «${state}»`;
  const place = field(doc, "ubicacion");
  if (CLOSED_PLACES.includes(place)) return `ubicación «${place}»`;
  const sector = field(doc, "lugarSector");
  if (normalize(sector) !== CITY) return `sector «${sector}», no es Cali`;
  return null;
}

/** El municipio nombrado a mano en una fila que dice ser de Cali, si lo hay. */
function suspiciousTown(doc) {
  const written = normalize(
    `${field(doc, "lugarDireccion")} ${field(doc, "lugarBarrio")}`,
  );
  return NEARBY_TOWNS.find((town) => written.includes(town)) ?? null;
}

/**
 * La foto principal, ya decodificada. Vive en otra colección y es un data url,
 * así que esto es lo único que cuesta una petición por mascota.
 */
async function fetchPhoto(code, index) {
  const doc = await fetchJson(`${FIRESTORE}/fotos/${code}?key=${API_KEY}`);
  const photos = value(doc.fields?.imgs) ?? [];
  const photo = photos[Number(index) || 0] ?? photos[0];
  if (!photo) throw new Error("no tiene fotos");

  const [header, data] = String(photo).split(",", 2);
  if (!data || !header.startsWith("data:image/jpeg")) {
    throw new Error(`la foto no es un jpeg («${header.slice(0, 30)}»)`);
  }
  return Buffer.from(data, "base64");
}

/**
 * Lo ya publicado en una corrida anterior. El seeder escribe el `id` de cada
 * fila en su propio archivo, y recogerlo acá es lo que hace que volver a bajar
 * la tanda no la publique dos veces.
 */
async function publishedIds(file) {
  try {
    const previous = JSON.parse(await readFile(file, "utf8"));
    return new Map(
      previous
        .filter((entry) => entry.id)
        .map((entry) => [entry.source, entry.id]),
    );
  } catch {
    return new Map();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const known = await publishedIds(args.file);

  const docs = await fetchPets();
  console.log(`${docs.length} mascotas en el origen.`);

  const entries = [];
  const warnings = [];
  let skipped = 0;

  await mkdir(args.photos, { recursive: true });
  await mkdir(dirname(args.file), { recursive: true });

  for (const doc of docs) {
    const code = field(doc, "code") ?? doc.name.split("/").pop();

    const reason = rejection(doc);
    if (reason) {
      console.log(`· ${code} se omite: ${reason}`);
      skipped += 1;
      continue;
    }

    const path = join(args.photos, `${code}.jpg`);
    try {
      await writeFile(
        path,
        await fetchPhoto(code, field(doc, "fotoPrincipal")),
      );
    } catch (error) {
      console.error(`✗ ${code} sin foto: ${error.message}`);
      skipped += 1;
      continue;
    }

    const town = suspiciousTown(doc);
    if (town) warnings.push(`${code} dice «${town}» con el sector en Cali`);

    entries.push({
      source: code,
      ref_code: code,
      kind: KINDS[field(doc, "especie")] ?? "other",
      sex: SEXES[field(doc, "genero")] ?? null,
      place_name: args.place,
      contact_username: args.username,
      image_path: path.split("\\").join("/"),
      ...(known.has(code) ? { id: known.get(code) } : {}),
    });
  }

  await writeFile(args.file, `${JSON.stringify(entries, null, 2)}\n`);

  console.log(`\n${entries.length} para publicar, ${skipped} omitidas.`);
  console.log(`Escrito ${args.file}, fotos en ${args.photos}/`);
  if (warnings.length > 0) {
    console.log("\nRevisar a ojo antes de publicar:");
    for (const warning of warnings) console.log(`  ! ${warning}`);
  }
}

await main();
