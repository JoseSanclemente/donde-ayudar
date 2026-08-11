/**
 * Cálculo de un punto a partir de la malla vial.
 *
 * OSM tiene la numeración de apenas 1.086 edificios en toda Cali (~0,1%), así
 * que buscar la dirección casi nunca funciona. Pero sí tiene el callejero
 * completo, y la nomenclatura colombiana ya dice dónde está el punto: en el
 * cruce de dos vías, a tantos metros de la esquina. Eso se puede calcular.
 *
 * Medido contra esas 1.086 direcciones reales como referencia:
 * mediana 24 m, p75 86 m, p90 241 m — 65% por debajo de 50 m.
 */
import type { CaliAddress } from "./address";
import { unproject, type Point, type Polyline, type StreetIndex } from "./geo-index";

/** Más allá de esto la "esquina" no es tal: las vías ni se acercan. */
const MAX_CORNER_MISS = 80;

/**
 * Muchas vías de Cali están cortadas en OSM y nunca llegan a tocarse. Con este
 * margen la esquina sigue sirviendo, aunque el punto sea bastante menos fiable.
 */
const LOOSE_CORNER_MISS = 250;

/** Manzana caliceña típica. Fuera de este rango la esquina es sospechosa. */
const MIN_BLOCK = 40;
const MAX_BLOCK = 300;

/**
 * Una placa mayor que esto casi siempre significa que la manzana elegida no es
 * la correcta, no que haya que caminar medio kilómetro.
 */
const MAX_PLACA = 200;

export type Located = {
  lat: number;
  lng: number;
  /** La esquina desde la que se midió. */
  corner: { lat: number; lng: number };
  /** Nombres realmente usados, que pueden no ser los primeros candidatos. */
  via: string;
  cross: string;
  /** Cuánto se separan las dos vías en el cruce: 0 si comparten nodo. */
  cornerMiss: number;
  /** Distancia a la esquina contigua. `null` si no se pudo medir. */
  block: number | null;
};

const distance = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Punto del segmento `a-b` más cercano a `p`, y su distancia. */
function projectOnSegment(p: Point, a: Point, b: Point): [Point, number] {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return [a, distance(p, a)];

  const t = Math.max(
    0,
    Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lengthSquared),
  );
  const closest: Point = [a[0] + t * dx, a[1] + t * dy];
  return [closest, distance(p, closest)];
}

type Corner = { point: Point; way: Polyline; segment: number; miss: number };

/**
 * Una esquina por cada tramo de la vía: el punto del tramo más cercano a la
 * vía que cruza. Se proyecta sobre el segmento en vez de quedarse en el vértice
 * más próximo — solo ese detalle baja la mediana de error de 66 m a 27 m.
 */
function findCorners(via: Polyline[], cross: Polyline[], tolerance: number): Corner[] {
  const corners: Corner[] = [];

  for (const way of via) {
    let best: Corner | null = null;
    for (let i = 0; i < way.length - 1; i++) {
      for (const other of cross) {
        for (const vertex of other) {
          const [point, miss] = projectOnSegment(vertex, way[i], way[i + 1]);
          if (!best || miss < best.miss) best = { point, way, segment: i, miss };
        }
      }
    }
    if (best && best.miss <= tolerance) corners.push(best);
  }

  return corners.sort((a, b) => a.miss - b.miss);
}

/** Avanza `metres` sobre la polilínea desde `start`, en un sentido u otro. */
function walk(
  way: Polyline,
  segment: number,
  start: Point,
  metres: number,
  forward: boolean,
): Point {
  let position = start;
  let remaining = metres;

  const step = forward ? 1 : -1;
  for (
    let i = forward ? segment + 1 : segment;
    i >= 0 && i < way.length;
    i += step
  ) {
    const next = way[i];
    const length = distance(position, next);
    if (length >= remaining) {
      const t = length === 0 ? 0 : remaining / length;
      return [
        position[0] + (next[0] - position[0]) * t,
        position[1] + (next[1] - position[1]) * t,
      ];
    }
    remaining -= length;
    position = next;
  }
  // La vía se acabó antes que los metros: el extremo es lo más cerca que hay.
  return position;
}

/** "Carrera 45" con delta +1 → "Carrera 46". Conserva letra y cardinal. */
function neighbour(name: string, delta: number): string | null {
  const match = /^(.*?)(\d+)([A-Z]?)(.*)$/.exec(name);
  if (!match) return null;
  const [, prefix, number, , suffix] = match;
  const next = Number(number) + delta;
  if (next < 1) return null;
  // Se quita la letra: entre "Carrera 45A" y "Carrera 46" la manzana es la misma.
  return `${prefix}${next}${suffix}`.replace(/\s+/g, " ").trim();
}

/* ---- Modelo de la malla: dónde cae cada número ------------------------- */

/**
 * "Calle 13" nombra tramos repartidos por 20 km: hay una en el centro y otra en
 * el oriente, y ambas cruzan con una "Carrera 32" real. La esquina sola no
 * desempata — pero la numeración de Cali sí es monótona a escala de ciudad: el
 * número de calle predice la longitud (r=0,94) y el de carrera la latitud
 * (r=-0,995). Con eso se sabe en qué zona debería caer la dirección.
 */
type GridModel = { calle: Map<number, number>; carrera: Map<number, number> };

const models = new WeakMap<StreetIndex, GridModel>();

const median = (values: number[]) =>
  values.sort((a, b) => a - b)[Math.floor(values.length / 2)];

/** "Calle 13", "Avenida Carrera 15" → familia y número. Sin cardinal: el norte
 * y el oeste numeran aparte y mezclarlos rompería el modelo. */
function classify(name: string): { calleLike: boolean; number: number } | null {
  const match = /^(Avenida Calle|Avenida Carrera|Calle|Carrera|Diagonal|Transversal) (\d+)$/.exec(name);
  if (!match) return null;
  return { calleLike: /Calle|Diagonal/.test(match[1]), number: Number(match[2]) };
}

function gridModel(index: StreetIndex): GridModel {
  const cached = models.get(index);
  if (cached) return cached;

  const calle = new Map<number, number[]>();
  const carrera = new Map<number, number[]>();

  for (const [name, ways] of index) {
    const parsed = classify(name);
    if (!parsed || parsed.number > 130) continue;
    // Las calles se ordenan de este a oeste, las carreras de norte a sur.
    const axis = parsed.calleLike ? 0 : 1;
    const bucket = parsed.calleLike ? calle : carrera;
    const values = bucket.get(parsed.number) ?? [];
    for (const way of ways) for (const point of way) values.push(point[axis]);
    bucket.set(parsed.number, values);
  }

  const collapse = (bucket: Map<number, number[]>) =>
    new Map([...bucket].map(([number, values]) => [number, median(values)]));

  const model: GridModel = { calle: collapse(calle), carrera: collapse(carrera) };
  models.set(index, model);
  return model;
}

/** Interpola linealmente entre los dos números conocidos más cercanos. */
function positionOf(axis: Map<number, number>, number: number): number | null {
  const exact = axis.get(number);
  if (exact !== undefined) return exact;

  let below: [number, number] | null = null;
  let above: [number, number] | null = null;
  for (const entry of axis) {
    if (entry[0] < number && (!below || entry[0] > below[0])) below = entry;
    if (entry[0] > number && (!above || entry[0] < above[0])) above = entry;
  }
  if (!below || !above) return below?.[1] ?? above?.[1] ?? null;

  const t = (number - below[0]) / (above[0] - below[0]);
  return below[1] + (above[1] - below[1]) * t;
}

/** Dónde debería caer el cruce de estas dos vías según la numeración. */
function predict(via: string, cross: string, index: StreetIndex): Point | null {
  const model = gridModel(index);
  const a = classify(via.replace(/[A-Z]?( Bis)?$/, ""));
  const b = classify(cross.replace(/[A-Z]?( Bis)?$/, ""));
  if (!a || !b || a.calleLike === b.calleLike) return null;

  const [calle, carrera] = a.calleLike ? [a, b] : [b, a];
  const x = positionOf(model.calle, calle.number);
  const y = positionOf(model.carrera, carrera.number);
  return x === null || y === null ? null : [x, y];
}

/** Hasta dónde puede desviarse una esquina de lo que dice la numeración. */
const MAX_PREDICTION_MISS = 2500;

/* ----------------------------------------------------------------------- */

function waysFor(names: string[], index: StreetIndex): [string, Polyline[]] | null {
  for (const name of names) {
    const ways = index.get(name);
    if (ways) return [name, ways];
  }
  return null;
}

/**
 * Sentido en el que crece la numeración y, de paso, el largo de la manzana:
 * se busca el cruce siguiente (carrera N+1) sobre el mismo tramo y se camina
 * hacia él. Si no existe, sirve el anterior con el sentido invertido.
 */
function orient(
  corner: Corner,
  crossName: string,
  index: StreetIndex,
): { forward: boolean; block: number | null } {
  for (const [delta, sign] of [
    [1, 1],
    [-1, -1],
  ] as const) {
    const name = neighbour(crossName, delta);
    const ways = name ? index.get(name) : undefined;
    if (!ways) continue;

    const [adjacent] = findCorners([corner.way], ways, Infinity);
    if (!adjacent) continue;

    const segment = corner.way[corner.segment + 1];
    const direction: Point = [
      segment[0] - corner.way[corner.segment][0],
      segment[1] - corner.way[corner.segment][1],
    ];
    const towards: Point = [
      adjacent.point[0] - corner.point[0],
      adjacent.point[1] - corner.point[1],
    ];
    const sameWay = direction[0] * towards[0] + direction[1] * towards[1] >= 0;

    return {
      forward: sign === 1 ? sameWay : !sameWay,
      block: distance(corner.point, adjacent.point),
    };
  }

  return { forward: true, block: null };
}

export function locate(address: CaliAddress, index: StreetIndex): Located | null {
  const via = waysFor(address.via, index);
  if (!via) return null;
  const [viaName, viaWays] = via;

  // Sin placa lo único honesto es el punto medio del tramo más largo.
  if (address.cross.length === 0 || address.placa === null) return null;

  for (const crossName of address.cross) {
    const crossWays = index.get(crossName);
    if (!crossWays) continue;

    // El orden de los candidatos pesa más que lo apretada que sea la esquina:
    // medido, aflojar el margen antes de pasar al siguiente nombre da mejores
    // puntos que probar todos los nombres con el margen estrecho.
    let corners = findCorners(viaWays, crossWays, MAX_CORNER_MISS);
    if (corners.length === 0) corners = findCorners(viaWays, crossWays, LOOSE_CORNER_MISS);
    if (corners.length === 0) continue;

    const expected = predict(viaName, crossName, index);
    if (expected) {
      const plausible = corners.filter(
        (corner) => distance(corner.point, expected) <= MAX_PREDICTION_MISS,
      );
      if (plausible.length > 0) corners = plausible;
    }

    const metres = Math.min(address.placa, MAX_PLACA);
    let best: { score: number; located: Located } | null = null;

    // Solo los primeros candidatos: una vía con más de seis tramos que rocen la
    // misma carrera es un caso patológico, no un empate real.
    for (const corner of corners.slice(0, 6)) {
      const { forward, block } = orient(corner, crossName, index);
      const point = walk(corner.way, corner.segment, corner.point, metres, forward);

      // La coherencia de manzana es lo que descarta la vía homónima que está a
      // kilómetros: sin ella el p75 se va de 58 m a 91 m.
      let score = corner.miss;
      if (block === null) score += 150;
      else if (block < MIN_BLOCK || block > MAX_BLOCK) score += 200;
      if (expected) score += distance(corner.point, expected) / 10;

      if (best && score >= best.score) continue;
      best = {
        score,
        located: {
          ...unproject(point),
          corner: unproject(corner.point),
          via: viaName,
          cross: crossName,
          cornerMiss: corner.miss,
          block,
        },
      };
    }

    if (best) return best.located;
  }

  return null;
}

/** Punto medio de la vía, cuando la dirección no trae placa. */
export function locateStreet(
  address: CaliAddress,
  index: StreetIndex,
): { lat: number; lng: number; via: string } | null {
  const via = waysFor(address.via, index);
  if (!via) return null;
  const [viaName, ways] = via;

  const longest = ways.reduce((a, b) => (b.length > a.length ? b : a));
  return { ...unproject(longest[Math.floor(longest.length / 2)]), via: viaName };
}
