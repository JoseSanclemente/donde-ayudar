/**
 * Carga (una sola vez) los índices que genera `scripts/build-geo-index.mjs`.
 *
 * Se sirven como estáticos y se cachean en memoria: una búsqueda de dirección
 * no dispara ni una petición de red después del primer arranque.
 *
 * Datos © colaboradores de OpenStreetMap, bajo ODbL.
 */

type RawWay = [name: string, points: Array<[number, number]>];
type RawAddress = [
  street: string,
  number: string,
  lat: number,
  lon: number,
  name: string,
];

export type Point = [number, number];
export type Polyline = Point[];
export type StreetIndex = Map<string, Polyline[]>;

export type AddressEntry = {
  street: string;
  number: string;
  lat: number;
  lng: number;
  name: string;
};
export type AddressIndex = Map<string, AddressEntry[]>;

/**
 * Proyección plana local. A la latitud de Cali (3,44°) el error frente a una
 * geodésica es de centímetros a escala de ciudad, y permite trabajar toda la
 * geometría en metros con aritmética plana.
 */
export const LAT_METRES = 111_320;
export const LON_METRES = 111_320 * Math.cos((3.44 * Math.PI) / 180);

export const project = (lat: number, lng: number): Point => [
  lng * LON_METRES,
  lat * LAT_METRES,
];

export const unproject = (point: Point): { lat: number; lng: number } => ({
  lat: point[1] / LAT_METRES,
  lng: point[0] / LON_METRES,
});

async function loadJson<T>(path: string): Promise<T> {
  const response = await fetch(path);
  if (!response.ok)
    throw new Error(`No se pudo cargar ${path} (${response.status})`);
  return (await response.json()) as T;
}

let streets: Promise<StreetIndex> | null = null;

export function loadStreets(): Promise<StreetIndex> {
  streets ??= loadJson<RawWay[]>("/geo/streets.json").then((ways) => {
    const index: StreetIndex = new Map();
    for (const [name, points] of ways) {
      const projected = points.map(([lat, lon]) => project(lat, lon));
      const existing = index.get(name);
      if (existing) existing.push(projected);
      else index.set(name, [projected]);
    }
    return index;
  });
  return streets;
}

let addresses: Promise<AddressIndex> | null = null;

export const addressKey = (street: string, number: string) =>
  `${street.toLowerCase().replace(/\s+/g, " ").trim()}|${number.toLowerCase().replace(/\s+/g, "")}`;

export function loadAddresses(): Promise<AddressIndex> {
  addresses ??= loadJson<RawAddress[]>("/geo/addresses.json").then((rows) => {
    const index: AddressIndex = new Map();
    for (const [street, number, lat, lng, name] of rows) {
      const key = addressKey(street, number);
      const entry: AddressEntry = { street, number, lat, lng, name };
      const existing = index.get(key);
      if (existing) existing.push(entry);
      else index.set(key, [entry]);
    }
    return index;
  });
  return addresses;
}
