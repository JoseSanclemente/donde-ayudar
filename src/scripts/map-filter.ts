/**
 * Catálogo del filtro del mapa: qué se puede esconder y cómo se llama.
 *
 * Vive acá y no en la feature por lo mismo que `status.ts` y `resources.ts`: el
 * componente que dibuja las casillas lo lee para armarse, y la feature lo lee
 * para saber qué existe. Sin dominio de Supabase ni de DOM.
 */
import type { CenterType } from "./centers";

/**
 * Un reporte no es un `Center`, pero en el mapa son la misma pregunta: qué pin.
 * `afectada` tampoco lo es y ni siquiera es un pin —es la mancha de las zonas
 * con reportes de daño—, pero se apaga desde la misma fila, y esa fila es la
 * leyenda: es el único lugar donde la capa dice cómo se llama.
 */
export type MarkerKind = "reporte" | "afectada" | CenterType;

export type MapFilter = {
  kinds: Set<MarkerKind>;
  /** Esconde los puntos que hoy van grises: inactivos o vencidos. */
  onlyActiveCenters: boolean;
  /** Esconde los reportes que nadie confirma hace más de `STALE_HOURS`. */
  onlyRecentReports: boolean;
};

/**
 * Cada tipo con su chip y su figura.
 *
 * Las clases van literales, igual que en `resources.ts` y en `status.ts`: el
 * escáner de Tailwind lee este archivo como texto plano y una clase armada por
 * interpolación nunca se compila. `pin` no es de Tailwind sino de `global.css`,
 * donde vive el dibujo — es el mismo cuadrado, la misma gota y la misma casita
 * que el mapa, y agregar un tipo obliga a tocar los dos lados.
 */
export type KindInfo = {
  id: MarkerKind;
  label: string;
  /** Clase de la figura, gemela del marcador del mapa. */
  pin: string;
  /** El chip marcado, con el color de su marcador. Apagado lo pinta
   *  `ui/chip-group.ts`, que es de donde salen la forma y el gris. */
  chipOn: string;
};

export const MARKER_KINDS: KindInfo[] = [
  {
    id: "reporte",
    label: "Reportes",
    pin: "filter-pin-reporte",
    chipOn: "border-red-300 bg-red-50 text-red-800",
  },
  {
    id: "afectada",
    label: "Zonas afectadas",
    pin: "filter-pin-afectada",
    chipOn: "border-orange-300 bg-orange-50 text-orange-800",
  },
  {
    id: "acopio",
    label: "Puntos de acopio",
    pin: "filter-pin-acopio",
    chipOn: "border-indigo-300 bg-indigo-50 text-indigo-800",
  },
  {
    id: "albergue",
    label: "Albergues",
    pin: "filter-pin-albergue",
    chipOn: "border-amber-300 bg-amber-50 text-amber-900",
  },
  {
    id: "sangre",
    label: "Bancos de sangre",
    pin: "filter-pin-sangre",
    chipOn: "border-rose-300 bg-rose-50 text-rose-800",
  },
  {
    id: "healthcare",
    label: "Atención médica",
    pin: "filter-pin-healthcare",
    chipOn: "border-blue-300 bg-blue-50 text-blue-800",
  },
];

export const CENTER_KINDS = MARKER_KINDS.map(({ id }) => id).filter(
  (id): id is CenterType => id !== "reporte" && id !== "afectada",
);

/**
 * El mapa abre mostrándolo todo, menos lo que ya está apagado.
 *
 * `onlyActiveCenters` arranca encendido porque un cuadrito gris es un punto que
 * hoy no recibe a nadie, y el problema que resuelve este filtro es la cantidad
 * de pines. `onlyRecentReports` arranca apagado: que nadie haya confirmado una
 * necesidad en seis horas no la resuelve, y esconderla de entrada sería
 * contestarla borrándola.
 */
export const DEFAULT_MAP_FILTER: MapFilter = {
  kinds: new Set<MarkerKind>(MARKER_KINDS.map(({ id }) => id)),
  onlyActiveCenters: true,
  onlyRecentReports: false,
};

/** Si el filtro sigue como salió de fábrica: el botón lo anuncia. */
export function isDefaultFilter(filter: MapFilter): boolean {
  return (
    filter.kinds.size === MARKER_KINDS.length &&
    filter.onlyActiveCenters === DEFAULT_MAP_FILTER.onlyActiveCenters &&
    filter.onlyRecentReports === DEFAULT_MAP_FILTER.onlyRecentReports
  );
}
