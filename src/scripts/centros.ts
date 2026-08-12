/**
 * Curated points — collection centers, blood banks and shelters. Not editable
 * from the interface.
 *
 * This module is only the shape of one: the types and the narrowing everyone
 * shares. They live in the `centros` table, which only a maintainer with
 * `service_role` can write; reading them is `data/centros.ts`, and drawing them
 * is `map.ts`.
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
   * `false` = still open, not taking supplies right now. No `?`: the column is
   * `not null default true`, so the store always has a value to hand over.
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

