import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";
import { assertUniqueItems, CATEGORIES } from "./scripts/resources";

// Los centros de acopio no salen del formulario público: se agregan como
// archivos en el repo. El permiso de escritura al repositorio ES el privilegio
// de admin, y este schema es la validación que corre en cada build.

// Este archivo corre en cada build, así que es el sitio para las invariantes
// del catálogo: un recurso repetido en dos categorías tumba el build en vez de
// cambiarle el color a reportes ya guardados.
assertUniqueItems();

const categoryIds = CATEGORIES.map((category) => category.id) as [string, ...string[]];

/**
 * Campos de un punto que recibe insumos. Los comparten `acopio` y `albergue`:
 * un banco de sangre no recibe nada, así que su rama no los lleva.
 */
const recibidor = {
  /** Ids de `CATEGORIES` en resources.ts — así el filtro reusa el catálogo. */
  recibe: z.array(z.enum(categoryIds)).nonempty(),
  /**
   * `false` = sigue abierto pero no recibe por ahora (bodega llena, pausa
   * mientras despachan). Distinto de `activo: false`, que es "ya no existe
   * como punto": el que está en pausa se sigue dibujando, en gris.
   */
  recibiendo: z.boolean().default(true),
  /** Por qué no recibe. Solo se muestra con `recibiendo: false`. */
  nota_estado: z.string().optional(),
};

const comunes = {
  name: z.string(),
  direccion: z.string(),
  lat: z.number(),
  lng: z.number(),
  horario: z.string(),
  telefono: z.string().optional(),
  notas: z.string().optional(),
  /** Un punto que cerró se marca `activo: false`, no se borra. */
  activo: z.boolean().default(true),
};

// Tres tipos de punto curado. Un banco de sangre no recibe insumos, así que
// `recibe` no existe en su rama: el schema impide describir uno como el otro.
// `tipo` es obligatorio — un discriminador no admite valor por defecto.
const centros = defineCollection({
  loader: glob({ base: "./src/content/centros", pattern: "**/*.yaml" }),
  // `.strict()` en todas las ramas: sin él, Zod descarta las llaves desconocidas en
  // silencio, así que un `recibe` en un banco de sangre — o un campo con el
  // nombre mal escrito — se perdería sin que nadie se entere.
  schema: z.discriminatedUnion("tipo", [
    z
      .object({
        tipo: z.literal("acopio"),
        ...recibidor,
        ...comunes,
      })
      .strict(),
    z
      .object({
        tipo: z.literal("sangre"),
        ...comunes,
      })
      .strict(),
    z
      .object({
        tipo: z.literal("albergue"),
        ...recibidor,
        ...comunes,
      })
      .strict(),
  ]),
});

export const collections = { centros };
