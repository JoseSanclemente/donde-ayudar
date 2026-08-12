/**
 * Catálogo de estados de un punto. Vive aparte de `resources.ts` porque no es
 * una necesidad sino una condición del sitio: si se puede llegar, si urge, si
 * ya no reciben a nadie.
 *
 * Las clases de Tailwind van literales, igual que en `resources.ts`: el escáner
 * lee estos archivos como texto plano y cualquier interpolación se queda sin
 * compilar.
 */

export type ReportStatus = "activo" | "urgente" | "saturado" | "cerrado";

export type StatusInfo = {
  id: ReportStatus;
  /** Etiqueta del chip y del filtro. */
  label: string;
  /** Frase del banner y del popup — dice qué hacer, no solo cómo se llama. */
  aviso: string;
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
    aviso: "Recibiendo ayuda",
    chip: "bg-slate-100 text-slate-700",
    chipOn: "border-slate-600 bg-slate-600 text-white",
    card: "border-slate-200 bg-white",
    bloqueado: false,
  },
  {
    id: "urgente",
    label: "Urgente",
    aviso: "Necesita ayuda con urgencia",
    chip: "bg-red-50 text-red-700",
    chipOn: "border-red-600 bg-red-600 text-white",
    card: "border-red-200 bg-red-50",
    bloqueado: false,
  },
  {
    id: "saturado",
    label: "Saturado",
    aviso: "Lleno — confirma antes de ir",
    chip: "bg-amber-50 text-amber-800",
    chipOn: "border-amber-600 bg-amber-600 text-white",
    card: "border-amber-200 bg-amber-50",
    bloqueado: true,
  },
  {
    id: "cerrado",
    label: "Cerrado",
    aviso: "Ya no reciben — no te desplaces",
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

export function markerEstado(status: string, allCovered: boolean): MarkerEstado {
  if (status === "cerrado") return "cerrado";
  if (status === "saturado") return "saturado";
  if (allCovered) return "cubierto";
  if (status === "urgente") return "urgente";
  return "activo";
}

/** Filtros de la lista. `null` = todos. */
export const LIST_FILTERS = [
  { id: null, label: "Todos" },
  { id: "urgente" as const, label: "Urgentes" },
  { id: "abiertos" as const, label: "Abiertos" },
];
