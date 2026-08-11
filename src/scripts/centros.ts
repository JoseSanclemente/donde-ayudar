/**
 * Puntos curados por el equipo — acopios, bancos de sangre y albergues —, no
 * editables desde la interfaz.
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

/** Lo que comparten los puntos que reciben insumos: `acopio` y `albergue`. */
type Recibidor = {
  /** Ids de categoría de `resources.ts`. */
  recibe: string[];
  /**
   * `false` = sigue abierto pero no recibe por ahora. Sin `?`: el schema le
   * aplica el default en build, así que siempre llega serializado.
   */
  recibiendo: boolean;
  /** Por qué no recibe. Solo se muestra con `recibiendo: false`. */
  nota_estado?: string;
};

export type CentroAcopio = Base & Recibidor & { tipo: "acopio" };

/** Punto permanente de donación de sangre: no recibe insumos, no lleva `recibe`. */
export type BancoSangre = Base & { tipo: "sangre" };

/** Albergue: recibe personas, y también insumos — lleva `recibe` como un acopio. */
export type Albergue = Base & Recibidor & { tipo: "albergue" };

export type Centro = CentroAcopio | BancoSangre | Albergue;

/**
 * Narrowing en un solo sitio: los tipos que reciben insumos son todos menos
 * `sangre`. Repetir `tipo === "acopio"` en cada consumidor es justo lo que se
 * rompe al agregar un cuarto tipo.
 */
export function recibeInsumos(centro: Centro): centro is CentroAcopio | Albergue {
  return centro.tipo !== "sangre";
}

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
