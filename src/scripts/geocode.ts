/**
 * Resuelve una dirección a un punto, en cuatro niveles: gana el primero que
 * responda.
 *
 *   1. índice local de direcciones — el edificio está mapeado en OSM (raro:
 *      son 1.086 en toda la ciudad, ~0,1%)
 *   2. cálculo sobre la malla vial — la nomenclatura ya dice dónde cae el punto
 *   3. Nominatim — para lo que se busca por nombre ("Hospital Universitario")
 *   4. clic en el mapa — lo resuelve la persona, en `app.ts`
 *
 * Los niveles 1 y 2 no tocan la red: leen los índices de `public/geo/`. Y son
 * de Cali nada más — el índice y la malla vial se construyen con los datos de
 * la ciudad. Fuera de Cali la cascada arranca directo en Nominatim, y si eso
 * tampoco encuentra la placa queda el clic en el mapa, que de todos modos es la
 * vía recomendada.
 */
import { parseAddress, type CaliAddress } from "./address";
import {
  addressKey,
  loadAddresses,
  loadStreets,
  type AddressEntry,
} from "./geo-index";
import { locate, locateStreet } from "./grid";

export type GeocodeResult = {
  label: string;
  detail: string;
  lat: number;
  lng: number;
  /**
   * "exacta"     = el edificio está en OSM.
   * "calculada"  = punto deducido de la esquina y los metros de la placa.
   * "aproximada" = solo se pudo ubicar la vía.
   */
  precision: "exacta" | "calculada" | "aproximada";
};

/* ---- Niveles 1 y 2: índices locales ------------------------------------ */

function fromEntry(entry: AddressEntry): GeocodeResult {
  return {
    label: entry.name || `${entry.street} # ${entry.number}`,
    detail: entry.name ? `${entry.street} # ${entry.number}` : "dirección mapeada en OSM",
    lat: entry.lat,
    lng: entry.lng,
    precision: "exacta",
  };
}

async function fromIndexes(address: CaliAddress): Promise<GeocodeResult[]> {
  const [addresses, streets] = await Promise.all([loadAddresses(), loadStreets()]);

  const number = address.label.split("#")[1]?.trim() ?? "";
  for (const via of address.via) {
    const entries = addresses.get(addressKey(via, number));
    if (entries) return entries.map(fromEntry);
  }

  const located = locate(address, streets);
  if (located) {
    return [
      {
        label: address.label,
        detail: `esquina con ${located.cross}, a ${address.placa} m`,
        lat: located.lat,
        lng: located.lng,
        precision: "calculada",
      },
    ];
  }

  const street = locateStreet(address, streets);
  if (street) {
    return [
      {
        label: street.via,
        detail: "solo se pudo ubicar la vía",
        lat: street.lat,
        lng: street.lng,
        precision: "aproximada",
      },
    ];
  }

  return [];
}

/* ---- Nivel 3: Nominatim ------------------------------------------------ */

const ENDPOINT = "https://nominatim.openstreetmap.org/search";

// Cali bounding box (left, top, right, bottom). Va sin `bounded`, así que es una
// preferencia y no un recorte: Nominatim pone primero lo que cae adentro y sigue
// devolviendo el resto. Con `bounded=1` una dirección de Buga no aparecía, y la
// ayuda ya se está coordinando con otros municipios.
const VIEWBOX = "-76.62,3.52,-76.44,3.32";

// Nominatim usage policy: at most 1 request per second.
const MIN_INTERVAL_MS = 1100;
let lastRequestAt = 0;

type NominatimItem = {
  display_name?: string;
  name?: string;
  lat?: string;
  lon?: string;
  category?: string;
  place_rank?: number;
  address?: Record<string, string | undefined>;
};

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Quita la cola administrativa ("RAP Pacífico, Colombia") del display_name. */
function shortLabel(item: NominatimItem): { label: string; detail: string } {
  const address = item.address ?? {};
  const primary =
    item.name ||
    address.building ||
    address.amenity ||
    address.road ||
    (item.display_name ?? "").split(",")[0];

  const context = [
    address.neighbourhood,
    address.suburb,
    address.city_district,
    address.postcode,
  ].filter(Boolean) as string[];

  return {
    label: primary || (item.display_name ?? ""),
    detail: context.join(" · "),
  };
}

async function query(q: string, signal?: AbortSignal): Promise<NominatimItem[]> {
  const elapsed = Date.now() - lastRequestAt;
  if (elapsed < MIN_INTERVAL_MS) await wait(MIN_INTERVAL_MS - elapsed);
  if (signal?.aborted) return [];
  lastRequestAt = Date.now();

  const url = new URL(ENDPOINT);
  url.searchParams.set("q", q);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("limit", "8");
  url.searchParams.set("countrycodes", "co");
  url.searchParams.set("viewbox", VIEWBOX);

  const response = await fetch(url, {
    signal,
    headers: { "Accept-Language": "es" },
  });
  if (!response.ok) throw new Error(`Nominatim respondió ${response.status}`);
  const data = await response.json();
  return Array.isArray(data) ? (data as NominatimItem[]) : [];
}

function toResults(items: NominatimItem[]): GeocodeResult[] {
  return items
    .filter((item) => {
      // place_rank 12/14 = municipio y ciudad. Devolver "Cali, Valle del Cauca"
      // como ubicación de un edificio no sirve de nada. En jsonv2 la clase del
      // objeto viene en `category`, no en `class`.
      const rank = item.place_rank ?? 0;
      return rank >= 16 && item.category !== "boundary";
    })
    .map((item) => {
      const { label, detail } = shortLabel(item);
      return {
        label,
        detail,
        lat: Number(item.lat),
        lng: Number(item.lon),
        precision: (item.place_rank ?? 0) >= 30 ? "exacta" : "aproximada",
      } satisfies GeocodeResult;
    })
    .filter((r) => r.label && Number.isFinite(r.lat) && Number.isFinite(r.lng));
}

/* ---- Orquestación ------------------------------------------------------ */

export async function geocode(
  input: string,
  signal?: AbortSignal,
): Promise<GeocodeResult[]> {
  if (input.trim().length < 3) return [];

  const address = parseAddress(input);
  if (address) {
    try {
      const results = await fromIndexes(address);
      if (results.length > 0 || signal?.aborted) return results;
    } catch (error) {
      // Si el índice no cargó, Nominatim sigue siendo mejor que nada.
      console.warn("Índice local no disponible:", error);
    }
  }

  return toResults(await query(`${input}, Cali, Valle del Cauca, Colombia`, signal));
}

export function debounce<A extends unknown[]>(
  fn: (...args: A) => void,
  ms: number,
): (...args: A) => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (...args: A) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}
