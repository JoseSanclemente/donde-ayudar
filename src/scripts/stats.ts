/**
 * Las cifras de la emergencia: qué número existe, cómo se llama y en qué orden
 * va.
 *
 * Vive acá y no en la feature por lo mismo que `resources.ts`, `volunteers.ts` y
 * `pets-filter.ts`: el catálogo es del repo, no de la base. Una fila de `stats`
 * guarda un objeto con las llaves que la fuente publicó ese día, y esta lista es
 * la que decide cuáles se pintan, con qué etiqueta y en qué orden. Agregar una
 * cifra es una entrada acá más la llave en el SQL — sin migración.
 *
 * Sin Supabase y sin DOM.
 */

/** Un corte: una fila de `stats`, que es un balance entero de una fuente. */
export type Snapshot = {
  id: string;
  /** Quién lo publicó. Hoy siempre la UNGRD, y a la vista en la tarjeta. */
  source: string;
  sourceUrl?: string;
  /** El corte que estampó la fuente, no cuándo se guardó la fila. */
  cutAt: string;
  /** Llave del catálogo -> número. Lo que no publicó ese corte, no está. */
  figures: Record<string, number>;
};

export type Figure = {
  id: string;
  label: string;
  /**
   * Las seis que van grandes. El resto va en una lista compacta debajo: una
   * tarjeta con dieciocho números del mismo tamaño no dice cuál importa.
   */
  headline: boolean;
  /**
   * Desglose por departamento. Es también cómo la tienda encuentra el corte que
   * lo trae: el balance más reciente no publica desglose y el del 13 de agosto
   * sí, así que los dos bloques salen de filas distintas y cada uno lleva su
   * propia fecha.
   */
  departmental: boolean;
};

/**
 * El orden es el de la tarjeta. Primero la gente y después las cosas, que es el
 * orden en que se leen: un muerto no es un dato del mismo tipo que un acueducto.
 */
export const FIGURES: Figure[] = [
  { id: "fallecidos", label: "Fallecidos", headline: true, departmental: false },
  { id: "heridos", label: "Heridos", headline: true, departmental: false },
  { id: "desaparecidos", label: "Desaparecidos", headline: true, departmental: false },
  { id: "personas_afectadas", label: "Personas afectadas", headline: true, departmental: false },
  { id: "viviendas_destruidas", label: "Viviendas destruidas", headline: true, departmental: false },
  { id: "viviendas_averiadas", label: "Viviendas averiadas", headline: true, departmental: false },

  { id: "rescatados", label: "Personas rescatadas", headline: false, departmental: false },
  { id: "familias_afectadas", label: "Familias afectadas", headline: false, departmental: false },
  { id: "edificaciones_colapsadas", label: "Edificaciones colapsadas", headline: false, departmental: false },
  { id: "sedes_educativas", label: "Sedes educativas afectadas", headline: false, departmental: false },
  { id: "centros_salud", label: "Centros de salud afectados", headline: false, departmental: false },
  { id: "centros_comunitarios", label: "Centros comunitarios afectados", headline: false, departmental: false },
  { id: "vias", label: "Vías afectadas", headline: false, departmental: false },
  { id: "acueductos", label: "Acueductos afectados", headline: false, departmental: false },
  { id: "puentes_vehiculares", label: "Puentes vehiculares afectados", headline: false, departmental: false },
  { id: "puentes_peatonales", label: "Puentes peatonales afectados", headline: false, departmental: false },
  { id: "aeropuertos", label: "Aeropuertos afectados", headline: false, departmental: false },
  { id: "departamentos", label: "Departamentos afectados", headline: false, departmental: false },
  { id: "municipios", label: "Municipios afectados", headline: false, departmental: false },

  // El desglose se lee como una sola pregunta —dónde murió la gente— así que las
  // etiquetas son el departamento y el encabezado del bloque pone el resto.
  { id: "fallecidos_valle", label: "Valle del Cauca", headline: false, departmental: true },
  { id: "fallecidos_risaralda", label: "Risaralda", headline: false, departmental: true },
  { id: "fallecidos_choco", label: "Chocó", headline: false, departmental: true },
  { id: "fallecidos_caldas", label: "Caldas", headline: false, departmental: true },
  { id: "fallecidos_quindio", label: "Quindío", headline: false, departmental: true },
];

const DEPARTMENTAL_IDS = new Set(
  FIGURES.filter((figure) => figure.departmental).map((figure) => figure.id),
);

/** Si el corte trae desglose por departamento. */
export function hasDepartmental(snapshot: Snapshot): boolean {
  return Object.keys(snapshot.figures).some((key) => DEPARTMENTAL_IDS.has(key));
}

/**
 * Las cifras del corte que este catálogo sabe nombrar, en el orden de `FIGURES`.
 *
 * Lo que el corte no trajo se salta y lo que no está en el catálogo se ignora:
 * un balance con una llave nueva no puede romper la tarjeta, igual que una
 * columna nueva no invalida una fila en `data/centers.ts`.
 */
export function readFigures(
  snapshot: Snapshot,
  kind: "headline" | "rest" | "departmental",
): { id: string; label: string; value: number }[] {
  return FIGURES.filter((figure) => {
    if (kind === "departmental") return figure.departmental;
    if (figure.departmental) return false;
    return kind === "headline" ? figure.headline : !figure.headline;
  })
    .map((figure) => ({ ...figure, value: snapshot.figures[figure.id] }))
    .filter(
      (figure): figure is Figure & { value: number } =>
        typeof figure.value === "number" && Number.isFinite(figure.value),
    )
    .map(({ id, label, value }) => ({ id, label, value }));
}

/** «115.461», con el punto de miles que se usa en Colombia. */
export function formatFigure(value: number): string {
  return new Intl.NumberFormat("es-CO").format(Math.round(value));
}
