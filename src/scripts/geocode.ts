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
 * la ciudad. Por eso, cuando la dirección nombra otro municipio
 * (`namesAnotherCity`), la cascada se los salta: la nomenclatura de Yumbo
 * parsea igual de bien que la de Cali y resolverla contra la malla de Cali no
 * falla, devuelve un punto de Cali.
 *
 * El nivel 3 se pregunta dos veces, una sesgada a Cali y otra al país entero.
 * Gana la primera que responda algo, y el orden lo decide esa misma cola de la
 * dirección. Se pregunta dos veces porque un lugar escrito por nombre —"Lomitas,
 * La Cumbre"— no deja cola que leer, y con "Cali" pegado detrás Nominatim
 * devuelve cero: el cero es la señal. Si ninguna de las dos encuentra la placa
 * queda el clic en el mapa, que de todos modos es la vía recomendada.
 */
import { namesAnotherCity, parseAddress, type CaliAddress } from "./address";
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

function fromEntry(entry: AddressEntry): GeocodeResult {
  return {
    label: entry.name || `${entry.street} # ${entry.number}`,
    detail: entry.name
      ? `${entry.street} # ${entry.number}`
      : "dirección mapeada en OSM",
    lat: entry.lat,
    lng: entry.lng,
    precision: "exacta",
  };
}

async function fromIndexes(address: CaliAddress): Promise<GeocodeResult[]> {
  const [addresses, streets] = await Promise.all([
    loadAddresses(),
    loadStreets(),
  ]);

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

const ENDPOINT = "https://nominatim.openstreetmap.org/search";
const REVERSE_ENDPOINT = "https://nominatim.openstreetmap.org/reverse";

const VIEWBOX = "-76.62,3.52,-76.44,3.32";

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

function shortLabel(item: NominatimItem): { label: string; detail: string } {
  const address = item.address ?? {};
  const primary =
    item.name ||
    address.building ||
    address.amenity ||
    address.road ||
    (item.display_name ?? "").split(",")[0];

  const municipio = address.city || address.town || address.municipality;

  const context = [
    address.neighbourhood,
    address.suburb,
    address.city_district,
    municipio && !/^(santiago de )?cali$/i.test(municipio)
      ? municipio
      : undefined,
    address.postcode,
  ].filter(Boolean) as string[];

  return {
    label: primary || (item.display_name ?? ""),
    detail: context.join(" · "),
  };
}

/**
 * Espera el turno que la política de uso de Nominatim exige.
 *
 * La cola es lo que hace que el freno sea un freno: leyendo `lastRequestAt` a
 * secas, dos llamadas que empiezan a la vez —buscar mientras el reverso todavía
 * no vuelve— calculan la misma espera y salen juntas. La sanción por pasarse es
 * un bloqueo por IP, y la IP es la de quien está mirando el mapa.
 */
let queue: Promise<void> = Promise.resolve();

function throttle(): Promise<void> {
  const turn = queue.then(async () => {
    const elapsed = Date.now() - lastRequestAt;
    if (elapsed < MIN_INTERVAL_MS) await wait(MIN_INTERVAL_MS - elapsed);
    lastRequestAt = Date.now();
  });
  queue = turn;
  return turn;
}

async function query(
  q: string,
  { preferCali, signal }: { preferCali: boolean; signal?: AbortSignal },
): Promise<NominatimItem[]> {
  await throttle();
  if (signal?.aborted) return [];

  const url = new URL(ENDPOINT);
  url.searchParams.set("q", q);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("limit", "8");

  url.searchParams.set("countrycodes", "co");
  if (preferCali) url.searchParams.set("viewbox", VIEWBOX);

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

const MAX_NAME = 120;

/**
 * La dirección de un punto, para rellenar el campo cuando quien reporta usa su
 * ubicación. Solo Nominatim: los índices locales van en el sentido contrario
 * —de una placa a un punto— y darles la vuelta pide otra estructura.
 *
 * OSM tiene poco edificio residencial en Cali, así que muchas veces vuelve solo
 * la vía. Sirve igual: el punto ya quedó fijado por GPS, que es lo que lleva a
 * alguien hasta allá, y el texto queda editable para quien lo escriba mejor.
 *
 * Nunca lanza: quien la llama ya tiene las coordenadas y no puede quedarse sin
 * formulario porque la red falle.
 */
export async function reverseGeocode(
  coords: { lat: number; lng: number },
  signal?: AbortSignal,
): Promise<string | null> {
  try {
    await throttle();
    if (signal?.aborted) return null;

    const url = new URL(REVERSE_ENDPOINT);
    url.searchParams.set("lat", String(coords.lat));
    url.searchParams.set("lon", String(coords.lng));
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("addressdetails", "1");

    url.searchParams.set("zoom", "18");

    const response = await fetch(url, {
      signal,
      headers: { "Accept-Language": "es" },
    });
    if (!response.ok) return null;

    const item = (await response.json()) as NominatimItem;
    const address = item?.address ?? {};

    const via = address.road || item?.name;
    const calle = via
      ? address.house_number
        ? `${via} # ${address.house_number}`
        : via
      : null;

    const barrio = address.neighbourhood || address.suburb;
    const texto = [calle, barrio].filter(Boolean).join(", ");
    return texto ? texto.slice(0, MAX_NAME) : null;
  } catch {
    return null;
  }
}

export async function geocode(
  input: string,
  signal?: AbortSignal,
): Promise<GeocodeResult[]> {
  if (input.trim().length < 3) return [];

  const address = parseAddress(input);
  const otraCiudad = address ? namesAnotherCity(address) : false;

  if (address && !otraCiudad) {
    try {
      const results = await fromIndexes(address);
      if (results.length > 0 || signal?.aborted) return results;
    } catch (error) {
      console.warn("Índice local no disponible:", error);
    }
  }

  const cali = {
    q: `${input}, Cali, Valle del Cauca, Colombia`,
    preferCali: true,
  };
  const pais = { q: `${input}, Colombia`, preferCali: false };

  for (const { q, preferCali } of otraCiudad ? [pais, cali] : [cali, pais]) {
    if (signal?.aborted) return [];
    const results = toResults(await query(q, { preferCali, signal }));
    if (results.length > 0) return results;
  }

  return [];
}
