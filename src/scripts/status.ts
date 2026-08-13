/**
 * Catálogo de estados de un punto. Vive aparte de `resources.ts` porque no es
 * una necesidad sino una condición del sitio: si se puede llegar, si urge, si
 * ya no reciben a nadie.
 *
 * Las clases de Tailwind van literales, igual que en `resources.ts`: el escáner
 * lee estos archivos como texto plano y cualquier interpolación se queda sin
 * compilar.
 */

import { hoursSince, newestIso } from "./ui/time";

export type ReportStatus = "activo" | "urgente" | "saturado" | "cerrado";

export type StatusInfo = {
  id: ReportStatus;
  /** Etiqueta del chip y del filtro. */
  label: string;
  chip: string;
  chipOn: string;
  /** Borde y fondo de la tarjeta en la lista: el estado se ve sin leer el chip. */
  card: string;
  /**
   * `true` = no te desplaces sin confirmar. Es lo que arma el banner y lo que
   * apaga el marcador: un punto saturado sigue en el mapa, pero deja de pedir
   * gente.
   */
  bloqueado: boolean;
};

export const STATUSES: StatusInfo[] = [
  {
    id: "activo",
    label: "Activo",
    chip: "bg-slate-100 text-slate-700",
    chipOn: "border-slate-600 bg-slate-600 text-white",
    card: "border-slate-200 bg-white",
    bloqueado: false,
  },
  {
    id: "urgente",
    label: "Urgente",
    chip: "bg-red-50 text-red-700",
    chipOn: "border-red-600 bg-red-600 text-white",
    card: "border-red-200 bg-red-50",
    bloqueado: false,
  },
  {
    id: "saturado",
    label: "Saturado",
    chip: "bg-amber-50 text-amber-800",
    chipOn: "border-amber-600 bg-amber-600 text-white",
    card: "border-amber-200 bg-amber-50",
    bloqueado: true,
  },
  {
    id: "cerrado",
    label: "Cerrado",
    chip: "bg-slate-200 text-slate-600",
    chipOn: "border-slate-700 bg-slate-700 text-white",
    card: "border-slate-300 bg-slate-100",
    bloqueado: true,
  },
];

const BY_ID = new Map(STATUSES.map((s) => [s.id, s]));

/** Una fila guardada por una versión futura no puede tumbar el render. */
export function statusInfo(id: string): StatusInfo {
  return BY_ID.get(id as ReportStatus) ?? STATUSES[0];
}

export function isStatus(value: unknown): value is ReportStatus {
  return typeof value === "string" && BY_ID.has(value as ReportStatus);
}

export function isBlocked(id: string): boolean {
  return statusInfo(id).bloqueado;
}

/**
 * Lo que se pinta en el mapa. Un solo valor y no cinco clases que se pisan.
 *
 * La precedencia dice qué gana cuando varias cosas son ciertas a la vez:
 * «cerrado» tapa todo lo demás porque llegar allá es perder el viaje, y
 * «cubierto» pesa más que «urgente» porque un urgente ya resuelto no debe
 * seguir llamando gente.
 */
export type MarkerEstado = ReportStatus | "cubierto";

export function markerEstado(
  status: string,
  allCovered: boolean,
): MarkerEstado {
  if (status === "cerrado") return "cerrado";
  if (status === "saturado") return "saturado";
  if (allCovered) return "cubierto";
  if (status === "urgente") return "urgente";
  return "activo";
}

/**
 * How long a closed point stays visible after it was closed.
 *
 * Closing means the place needs nobody else, but somebody may already be on
 * their way: an hour is enough for them to reach the marker and read why it
 * went quiet. After that the pin is only noise competing with the live ones.
 */
export const RETIRE_HOURS = 1;

/**
 * How long a point stays visible with nobody touching it.
 *
 * A need nobody has confirmed in a working day's worth of hours is a guess, not
 * a fact: `isStale` already warns at 6 h, and two hours later the pin stops
 * claiming to be live. Marking a status keeps it alive.
 */
export const IDLE_HOURS = 8;

/** Off the map and off the list: closed a while ago, or idle for too long. */
export function isRetired(status: ReportStatus, statusAt: string, createdAt: string): boolean {
  if (status === "cerrado") return hoursSince(statusAt) >= RETIRE_HOURS;
  return hoursSince(newestIso(statusAt, createdAt)) >= IDLE_HOURS;
}

/** Filtros de la lista. `null` = todos. */
export const LIST_FILTERS = [
  { id: null, label: "Todos" },
  { id: "urgente" as const, label: "Urgentes" },
  { id: "abiertos" as const, label: "Abiertos" },
];

// The list opens on what needs attention first. Anything else buries the
// urgent zones under the ones already being handled.
export const DEFAULT_LIST_FILTER: string | null = "urgente";
