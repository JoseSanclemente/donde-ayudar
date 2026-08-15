/**
 * Zonas con reportes de daño: la forma del dato y cómo se lee.
 *
 * Es una capa curada y estática — la genera `scripts/build-affected-zones.mjs`
 * y se sirve desde `public/geo/`, igual que la malla vial. Nada de Supabase:
 * no la escribe nadie desde el navegador y no cambia en vivo.
 *
 * Se dibuja como círculo y nunca como pin, y esa es la decisión de fondo: la
 * fuente dice que estar en el mapa no implica daño estructural ni riesgo de
 * colapso, y un pin sobre un edificio se lee como un dictamen sobre ese
 * edificio. El círculo contesta lo que el dato sí sostiene — «por acá hubo
 * reportes» — y el centroide viene redondeado del script para que de un
 * círculo publicado no se pueda reconstruir una dirección.
 */

/** [lat, lng, radio en metros, reportes, colapsos, sector] tal y como sale del índice. */
type RawZone = [number, number, number, number, number, string];

export type AffectedZone = {
  lat: number;
  lng: number;
  /** Radio en metros. */
  radius: number;
  /** Cuántas direcciones se fundieron en esta zona. */
  reports: number;
  /** Cuántas de ellas venían marcadas como colapso. */
  collapses: number;
  /** Barrio o sector, escrito a mano en la lista fuente. */
  label: string;
};

/** El naranja de la fuente. Leaflet pinta vectores con estilo, no con clases. */
export const ZONE_FILL = "#f97316";

/** El aviso que viaja con el dato. Sin esto la capa dice algo que la fuente no dice. */
export const ZONE_DISCLAIMER = [
  "Esto no es un censo ni un mapa oficial: son reportes ciudadanos y de medios, recogidos a mano.",
  "Que un lugar caiga dentro de la zona no dice nada sobre el estado de una edificación en particular.",
  "No te acerques a las zonas de colapso salvo indicación expresa de las autoridades.",
];

let zones: Promise<AffectedZone[]> | null = null;

export function loadAffectedZones(): Promise<AffectedZone[]> {
  zones ??= fetch("/geo/affected-zones.json")
    .then((response) => {
      if (!response.ok)
        throw new Error(`No se pudo cargar /geo/affected-zones.json (${response.status})`);
      return response.json() as Promise<RawZone[]>;
    })
    .then((rows) =>
      rows.map(([lat, lng, radius, reports, collapses, label]) => ({
        lat,
        lng,
        radius,
        reports,
        collapses,
        label,
      })),
    );
  return zones;
}
