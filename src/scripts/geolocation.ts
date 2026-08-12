/**
 * Dónde está quien abre el mapa. No es geocodificación: aquí no se traduce la
 * posición a una dirección ni a una ciudad, solo se devuelven las coordenadas
 * para que el mapa arranque donde la persona puede hacer algo.
 *
 * Nada de esto falla hacia afuera: sin permiso, sin API o sin respuesta a
 * tiempo, el mapa se queda en Cali y la persona no ve ningún error.
 */

export type Coords = { lat: number; lng: number };

const CACHE_KEY = "da:last-coords";
/** Una ciudad no cambia de sitio, pero quien la visita sí se muda. */
const CACHE_TTL = 30 * 24 * 60 * 60 * 1000;

const OPTIONS: PositionOptions = {
  // Centrar un mapa a nivel de ciudad no necesita GPS: la alta precisión cuesta
  // segundos y batería para ganar metros que a este zoom no se ven.
  enableHighAccuracy: false,
  timeout: 8_000,
  maximumAge: 10 * 60 * 1000,
};

/** `null` cuando no hay API, no hay permiso o no llegó a tiempo. Nunca rechaza. */
export function locateUser(): Promise<Coords | null> {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => resolve({ lat: coords.latitude, lng: coords.longitude }),
      () => resolve(null),
      OPTIONS,
    );
  });
}

type CachedCoords = Coords & { at: number };

/**
 * La posición de la visita anterior. Se aplica en el `setView` inicial, antes
 * de que el permiso conteste: así la segunda visita abre ya en su ciudad, sin
 * el salto desde Cali.
 */
export function readCachedCoords(): Coords | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw) as Partial<CachedCoords>;
    if (
      typeof cached.lat !== "number" ||
      typeof cached.lng !== "number" ||
      typeof cached.at !== "number" ||
      Date.now() - cached.at > CACHE_TTL
    ) {
      return null;
    }
    return { lat: cached.lat, lng: cached.lng };
  } catch {
    // JSON corrupto, o `localStorage` bloqueado en navegación privada.
    return null;
  }
}

export function writeCachedCoords({ lat, lng }: Coords): void {
  try {
    const entry: CachedCoords = { lat, lng, at: Date.now() };
    localStorage.setItem(CACHE_KEY, JSON.stringify(entry));
  } catch {
    // Sin caché se pierde el arranque instantáneo, no la funcionalidad.
  }
}
