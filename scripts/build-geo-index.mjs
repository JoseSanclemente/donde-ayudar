/**
 * Descarga de OpenStreetMap la malla vial y las direcciones de Cali, y las
 * guarda en public/geo/ como índices compactos que la app carga una sola vez.
 *
 *   node scripts/build-geo-index.mjs
 *
 * No corre en cada build: los datos de OSM cambian lento y la consulta tarda
 * ~90 s. Se ejecuta a mano cuando se quiera refrescar el índice.
 *
 * Datos © colaboradores de OpenStreetMap, bajo ODbL.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";

const ENDPOINT = "https://overpass-api.de/api/interpreter";

/**
 * Relación de "Cali ciudad" — el casco urbano, sin los corregimientos rurales.
 *
 * Acotar por bbox metía a Yumbo, que tiene su propia Calle 15 y su propia
 * Carrera 31: direcciones del todo válidas que caen a 10 km de las de Cali y
 * envenenan la desambiguación. Buscar el área por nombre agota el timeout;
 * por id tarda dos segundos.
 */
const CALI = 8811628;
const AREA = `rel(${CALI});map_to_area->.cali;`;

const OUT_DIR = new URL("../public/geo/", import.meta.url);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function overpass(query, attempt = 1) {
  const response = await fetch(ENDPOINT, {
    method: "POST",
    // Sin User-Agent propio Overpass responde 406.
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "donde_ayudar_cali/0.1 (build-geo-index)",
    },
    body: new URLSearchParams({ data: query }),
  });

  // La instancia pública limita por IP y dos consultas seguidas ya la rozan.
  if ((response.status === 429 || response.status === 504) && attempt <= 4) {
    const wait = attempt * 20_000;
    console.log(`  ${response.status}, reintento en ${wait / 1000} s…`);
    await sleep(wait);
    return overpass(query, attempt + 1);
  }
  if (!response.ok) {
    throw new Error(`Overpass respondió ${response.status}: ${await response.text()}`);
  }

  const data = await response.json();
  return data.elements ?? [];
}

/** 5 decimales ≈ 1 m: más precisión que eso no aporta y triplica el peso. */
const round = (value) => Number(value.toFixed(5));

async function buildStreets() {
  console.log("· descargando vías nombradas…");
  const elements = await overpass(
    `[out:json][timeout:300];${AREA}way["highway"]["name"](area.cali);out geom;`,
  );

  const ways = elements
    .filter((way) => Array.isArray(way.geometry) && way.geometry.length > 1)
    .map((way) => [
      way.tags.name,
      way.geometry.map((point) => [round(point.lat), round(point.lon)]),
    ]);

  const names = new Set(ways.map(([name]) => name));
  console.log(`  ${ways.length} vías, ${names.size} nombres distintos`);
  return ways;
}

async function buildAddresses() {
  console.log("· descargando objetos con dirección…");
  const elements = await overpass(
    `[out:json][timeout:300];${AREA}` +
      `(node["addr:housenumber"](area.cali);way["addr:housenumber"](area.cali););` +
      `out center tags;`,
  );

  const addresses = elements
    .map((item) => {
      const street = item.tags["addr:street"];
      const number = item.tags["addr:housenumber"];
      const lat = item.lat ?? item.center?.lat;
      const lon = item.lon ?? item.center?.lon;
      if (!street || !number || lat === undefined || lon === undefined) return null;
      return [street, number, round(lat), round(lon), item.tags.name ?? ""];
    })
    .filter(Boolean);

  console.log(`  ${addresses.length} direcciones con vía y placa`);
  return addresses;
}

async function save(name, payload) {
  const json = JSON.stringify(payload);
  await writeFile(new URL(name, OUT_DIR), json, "utf8");
  const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
  console.log(`  ${name}: ${kb(Buffer.byteLength(json))} (${kb(gzipSync(json).length)} gzip)`);
}

await mkdir(OUT_DIR, { recursive: true });

const streets = await buildStreets();
await save("streets.json", streets);

const addresses = await buildAddresses();
await save("addresses.json", addresses);

console.log("listo.");
