/**
 * Centros de acopio: lista curada por el equipo, no editable desde la interfaz.
 *
 * Viven como archivos YAML en `src/content/centros/` y los valida el schema de
 * `src/content.config.ts` en cada build. `index.astro` serializa la colección en
 * un `<script type="application/json">` y este módulo la lee de ahí — el sitio
 * es estático, así que no hay fetch ni endpoint que consultar.
 */
type Base = {
  id: string;
  name: string;
  direccion: string;
  lat: number;
  lng: number;
  horario: string;
  telefono?: string;
  notas?: string;
};

export type CentroAcopio = Base & {
  tipo: "acopio";
  /** Ids de categoría de `resources.ts`. */
  recibe: string[];
};

/** Punto permanente de donación de sangre: no recibe insumos, no lleva `recibe`. */
export type BancoSangre = Base & { tipo: "sangre" };

export type Centro = CentroAcopio | BancoSangre;

/** Lee el JSON embebido en el HTML. Devuelve `[]` si aún no hay centros. */
export function loadCentros(elementId = "centros-data"): Centro[] {
  const raw = document.getElementById(elementId)?.textContent;
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Centro[]) : [];
  } catch {
    return [];
  }
}
