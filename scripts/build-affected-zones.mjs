/**
 * Convierte la lista de edificaciones reportadas en las zonas que pinta el mapa.
 *
 *   node scripts/build-affected-zones.mjs
 *
 * Lee `data/affected-addresses.txt`, ubica cada dirección, funde las cercanas y
 * escribe `public/geo/affected-zones.json`.
 *
 * No corre en el build, a propósito: publicar no puede depender de que
 * Nominatim conteste, y el resultado se revisa a ojo contra el mapa fuente
 * antes de comitearlo.
 *
 * El paso de fundir no es una optimización — es lo que hace publicable el dato.
 * La fuente advierte que estar en el mapa no implica daño estructural, y un
 * punto por dirección diría exactamente eso de un edificio concreto. Por lo
 * mismo el centroide sale redondeado a tres decimales: de un círculo publicado
 * no se puede volver a la dirección que lo originó.
 *
 * Datos © colaboradores de OpenStreetMap, bajo ODbL.
 */
import { readFile, writeFile } from "node:fs/promises";
import { registerHooks } from "node:module";

// Los módulos de src/ se importan sin extensión, como espera Vite; Node no
// resuelve eso por su cuenta, así que se le enseña a probar con ".ts". Igual que
// en `eval-geo.mjs`, y por eso los imports de abajo son dinámicos: los estáticos
// se izan por encima del registro del hook.
registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context);
    } catch (error) {
      if (!specifier.startsWith(".")) throw error;
      return next(`${specifier}.ts`, context);
    }
  },
});

const { parseAddress } = await import("../src/scripts/address.ts");
const { locate } = await import("../src/scripts/grid.ts");
const { project } = await import("../src/scripts/geo-index.ts");

const SOURCE = new URL("../data/affected-addresses.txt", import.meta.url);
const CACHE = new URL("../data/affected-geocache.json", import.meta.url);
const STREETS = new URL("../public/geo/streets.json", import.meta.url);
const OUT = new URL("../public/geo/affected-zones.json", import.meta.url);

const ENDPOINT = "https://nominatim.openstreetmap.org/search";
// El mismo viewbox que usa `src/scripts/geocode.ts`, y por lo mismo: es una
// preferencia, no un recorte.
const VIEWBOX = "-76.62,3.52,-76.44,3.32";
// Nominatim usage policy: como mucho una petición por segundo.
const MIN_INTERVAL_MS = 1100;

/** Dos direcciones a menos de esto caen en la misma zona. */
const CLUSTER_M = 500;
/**
 * Ninguna zona baja de acá.
 *
 * Es el número que decide si esto es un mapa de zonas o de edificios. Con 250 m
 * un reporte suelto quedaba en un círculo del tamaño de dos cuadras, centrado en
 * la dirección: el redondeo del centroide deja de servir de nada si el radio es
 * tan chico como el error que introduce. A 400 m el punto puede estar en
 * cualquier parte del círculo, que es lo que la fuente dice de él.
 */
const MIN_RADIUS_M = 400;
/** Aire alrededor del punto más lejano del grupo. */
const PADDING_M = 150;
/**
 * Dos zonas que se llaman igual y están a menos de esto son una sola.
 *
 * La distancia sola no basta para decidir un grupo: El Refugio quedaba en dos
 * círculos a 612 m, superpuestos en pantalla y con la misma etiqueta, así que
 * tocar uno u otro contestaba «El Refugio · 1 reporte» dos veces. Si el barrio
 * es el mismo, la zona es la misma; subir `CLUSTER_M` hasta juntarlos, en
 * cambio, fundía medio centro de la ciudad en un solo borrón.
 */
const MERGE_LABEL_M = 1200;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* ---- La lista ---------------------------------------------------------- */

/**
 * Una entrada por línea, campos separados por `|`:
 *
 *   A12 | Carrera 39 # 4-21 | colapso | San Fernando | 3.421,-76.545
 *
 * El sector es opcional y se escribe a mano: derivarlo de la geocodificación
 * pondría un nombre de barrio equivocado sobre un dato que ya viene con
 * advertencias. La coordenada también es opcional y manda sobre todo lo demás.
 *
 * El `#` corta comentario en los dos últimos campos y no en la dirección, donde
 * es parte de la nomenclatura.
 */
const uncomment = (field) => field.split("#")[0].trim();

async function readSource() {
  const text = await readFile(SOURCE, "utf8");
  const entries = [];

  for (const [index, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;

    const fields = line.split("|").map((field) => field.trim());
    const code = fields[0];
    const address = fields[1];
    const severity = fields[2] || "afectacion";
    const sector = uncomment(fields[3] ?? "");
    const coords = uncomment(fields[4] ?? "");

    if (!code || !address) {
      throw new Error(`Línea ${index + 1}: faltan campos — "${line}"`);
    }
    if (severity !== "colapso" && severity !== "afectacion") {
      throw new Error(
        `Línea ${index + 1}: el tercer campo es "colapso" o "afectacion", no "${severity}"`,
      );
    }

    let manual = null;
    if (coords) {
      const [lat, lng] = coords.split(",").map(Number);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        throw new Error(`Línea ${index + 1}: coordenada ilegible — "${coords}"`);
      }
      manual = { lat, lng };
    }

    entries.push({ code, address, severity, sector, manual });
  }

  return entries;
}

/* ---- Nivel 2: la malla vial -------------------------------------------- */

/**
 * El índice que `geo-index.ts` arma en el navegador, pero desde disco: allá se
 * pide por HTTP con una ruta absoluta que en Node no existe.
 */
async function loadStreetIndex() {
  const index = new Map();
  for (const [name, points] of JSON.parse(await readFile(STREETS, "utf8"))) {
    const projected = points.map(([lat, lon]) => project(lat, lon));
    const existing = index.get(name);
    if (existing) existing.push(projected);
    else index.set(name, [projected]);
  }
  return index;
}

/**
 * `locateStreet` no es un nivel a propósito: devuelve el punto medio de la vía
 * en toda la ciudad, y dentro de un círculo de 250 m eso pone una zona en
 * cuadras que no reportaron nada. Acá o hay esquina o se pregunta afuera.
 */
function fromGrid(address, streets) {
  const parsed = parseAddress(address);
  if (!parsed) return null;
  const located = locate(parsed, streets);
  return located ? { lat: located.lat, lng: located.lng } : null;
}

/* ---- Nivel 3: Nominatim ------------------------------------------------ */

async function readCache() {
  try {
    return JSON.parse(await readFile(CACHE, "utf8"));
  } catch {
    return {};
  }
}

let lastRequestAt = 0;

async function fromNominatim(query) {
  const elapsed = Date.now() - lastRequestAt;
  if (elapsed < MIN_INTERVAL_MS) await sleep(MIN_INTERVAL_MS - elapsed);
  lastRequestAt = Date.now();

  const url = new URL(ENDPOINT);
  url.searchParams.set("q", `${query}, Cali, Valle del Cauca, Colombia`);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");
  url.searchParams.set("countrycodes", "co");
  url.searchParams.set("viewbox", VIEWBOX);

  const response = await fetch(url, {
    headers: {
      "Accept-Language": "es",
      "User-Agent": "donde_ayudar_cali/0.1 (build-affected-zones)",
    },
  });
  if (!response.ok) {
    throw new Error(`Nominatim respondió ${response.status} para "${query}"`);
  }

  const [item] = await response.json();
  if (!item) return null;
  return { lat: Number(item.lat), lng: Number(item.lon) };
}

/* ---- Fundir ------------------------------------------------------------ */

const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/**
 * Enlace simple: una entrada entra al grupo si está a menos de `CLUSTER_M` de
 * cualquiera de sus miembros, no del centro. Así una hilera de reportes a lo
 * largo de una avenida queda en una sola zona en vez de partirse en tres.
 */
function cluster(points) {
  const groups = [];
  const pending = [...points];

  while (pending.length > 0) {
    const group = [pending.pop()];
    let grew = true;
    while (grew) {
      grew = false;
      for (let i = pending.length - 1; i >= 0; i -= 1) {
        const candidate = pending[i];
        const near = group.some(
          (member) => distance(member.point, candidate.point) <= CLUSTER_M,
        );
        if (!near) continue;
        group.push(candidate);
        pending.splice(i, 1);
        grew = true;
      }
    }
    groups.push(group);
  }

  return groups;
}

/**
 * Cómo se llama la zona. Los sectores los ponen las entradas, nunca el script.
 *
 * Se nombran hasta dos y el resto queda en «y alrededores»: una zona que se come
 * tres barrios tiene que decirlo, y quedarse con el mayoritario esconde
 * justamente el barrio que alguien está buscando.
 */
function labelOf(group) {
  const counts = new Map();
  for (const { entry } of group) {
    if (!entry.sector) continue;
    counts.set(entry.sector, (counts.get(entry.sector) ?? 0) + 1);
  }
  if (counts.size === 0) return "Sector sin nombre";

  const sorted = [...counts].sort((a, b) => b[1] - a[1]).map(([name]) => name);
  if (sorted.length === 1) return sorted[0];
  if (sorted.length === 2) return `${sorted[0]} y ${sorted[1]}`;
  return `${sorted[0]}, ${sorted[1]} y alrededores`;
}

const centroidOf = (group) =>
  project(
    group.reduce((sum, { coords }) => sum + coords.lat, 0) / group.length,
    group.reduce((sum, { coords }) => sum + coords.lng, 0) / group.length,
  );

/** Junta los grupos que ya se llaman igual y están cerca. Ver `MERGE_LABEL_M`. */
function mergeByLabel(groups) {
  const merged = [];
  for (const group of groups) {
    const twin = merged.find(
      (candidate) =>
        labelOf(candidate) === labelOf(group) &&
        distance(centroidOf(candidate), centroidOf(group)) <= MERGE_LABEL_M,
    );
    if (twin) twin.push(...group);
    else merged.push([...group]);
  }
  return merged;
}

function toZone(group) {
  const lat = group.reduce((sum, { coords }) => sum + coords.lat, 0) / group.length;
  const lng = group.reduce((sum, { coords }) => sum + coords.lng, 0) / group.length;
  const centre = project(lat, lng);
  const spread = Math.max(...group.map(({ point }) => distance(point, centre)));

  return [
    // Tres decimales ≈ 110 m. Es el redondeo que separa una zona de una
    // dirección, y va acá y no en el navegador: lo que se publica es el archivo.
    Number(lat.toFixed(3)),
    Number(lng.toFixed(3)),
    Math.round(Math.max(MIN_RADIUS_M, spread + PADDING_M) / 10) * 10,
    group.length,
    group.filter(({ entry }) => entry.severity === "colapso").length,
    labelOf(group),
  ];
}

/* ---- Orquestación ------------------------------------------------------ */

const entries = await readSource();
if (entries.length === 0) {
  console.error("data/affected-addresses.txt no tiene ninguna entrada.");
  process.exit(1);
}
console.log(`${entries.length} direcciones en la lista.\n`);

const streets = await loadStreetIndex();
const cache = await readCache();
const located = [];
const failed = [];
const tally = { manual: 0, malla: 0, nominatim: 0 };

for (const entry of entries) {
  let coords = entry.manual;
  let level = "manual";

  if (!coords) {
    coords = fromGrid(entry.address, streets);
    level = "malla";
  }

  if (!coords) {
    const query = entry.sector ? `${entry.address}, ${entry.sector}` : entry.address;
    if (!(query in cache)) cache[query] = await fromNominatim(query);
    coords = cache[query];
    level = "nominatim";
  }

  const at = coords ? `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}` : "—";
  console.log(
    `  ${entry.code.padEnd(4)} ${(coords ? level : "SIN UBICAR").padEnd(10)} ${at.padEnd(22)} ${entry.address}`,
  );

  if (!coords) {
    failed.push(entry);
    continue;
  }
  tally[level] += 1;
  located.push({ entry, coords, point: project(coords.lat, coords.lng) });
}

// El caché se guarda pase lo que pase: una coordenada corregida a mano sobrevive
// a la siguiente corrida, y una lista larga no se vuelve a pedir entera.
await writeFile(CACHE, `${JSON.stringify(cache, null, 2)}\n`);

console.log(
  `\nMalla ${tally.malla} · Nominatim ${tally.nominatim} · a mano ${tally.manual}`,
);

if (failed.length > 0) {
  console.error(`\n${failed.length} sin ubicar:`);
  for (const entry of failed) console.error(`  ${entry.code} — ${entry.address}`);
  console.error(
    "\nCorregí la dirección en la lista, o poné la coordenada en el quinto campo.",
  );
  process.exit(1);
}

const zones = mergeByLabel(cluster(located)).map(toZone);
zones.sort((a, b) => b[3] - a[3]);

await writeFile(OUT, `${JSON.stringify(zones)}\n`);

console.log(`\n${zones.length} zonas:`);
for (const [lat, lng, radius, reports, collapses, label] of zones) {
  console.log(
    `  ${label} — ${reports} ${reports === 1 ? "reporte" : "reportes"} (${collapses} colapso), radio ${radius} m, ${lat}, ${lng}`,
  );
}
console.log(`\nEscrito en public/geo/affected-zones.json`);
