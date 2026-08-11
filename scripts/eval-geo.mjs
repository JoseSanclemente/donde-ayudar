/**
 * Regresión de precisión del geocodificador de malla.
 *
 *   node scripts/eval-geo.mjs
 *
 * Usa como referencia las direcciones que OSM sí tiene numeradas: se les pasa
 * el texto de la dirección al parser, se calcula el punto con `grid.locate` y
 * se compara con la coordenada real.
 *
 * La muestra son las 1.086 direcciones tal y como están escritas en OSM, con
 * su ruido incluido ("Calle 55 # 28E 2-55", "Carrera 65 # 1|2 32"). Un
 * prototipo sobre el subconjunto limpio daba mediana 22 m y 72% bajo 50 m; la
 * puerta va sobre la muestra completa, que es lo que la app va a ver.
 */
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";

// Los módulos de src/ se importan sin extensión, como espera Vite; Node no
// resuelve eso por su cuenta, así que se le enseña a probar con ".ts".
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

const read = async (name) =>
  JSON.parse(await readFile(new URL(`../public/geo/${name}`, import.meta.url), "utf8"));

const index = new Map();
for (const [name, points] of await read("streets.json")) {
  const projected = points.map(([lat, lon]) => project(lat, lon));
  const existing = index.get(name);
  if (existing) existing.push(projected);
  else index.set(name, [projected]);
}

const errors = [];
let unparsed = 0;
let unresolved = 0;

for (const [street, number, lat, lon] of await read("addresses.json")) {
  const address = parseAddress(`${street} # ${number}`);
  if (!address || address.placa === null) {
    unparsed++;
    continue;
  }

  const found = locate(address, index);
  if (!found) {
    unresolved++;
    continue;
  }

  const [ax, ay] = project(found.lat, found.lng);
  const [bx, by] = project(lat, lon);
  errors.push(Math.hypot(ax - bx, ay - by));
}

errors.sort((a, b) => a - b);
const percentile = (q) => errors[Math.floor(q * (errors.length - 1))];
const share = (limit) => (errors.filter((e) => e < limit).length / errors.length) * 100;

console.log(`evaluadas ${errors.length}  ·  sin parsear ${unparsed}  ·  sin resolver ${unresolved}`);
console.log(`p50 ${percentile(0.5).toFixed(0)} m   p75 ${percentile(0.75).toFixed(0)} m   p90 ${percentile(0.9).toFixed(0)} m`);
console.log(`<50 m ${share(50).toFixed(0)}%   <100 m ${share(100).toFixed(0)}%   <200 m ${share(200).toFixed(0)}%`);

const passes = percentile(0.5) <= 30 && share(50) >= 60 && share(200) >= 80;
console.log(passes ? "\nOK — dentro de la puerta." : "\nFALLA — por debajo de la puerta.");
process.exit(passes ? 0 : 1);
