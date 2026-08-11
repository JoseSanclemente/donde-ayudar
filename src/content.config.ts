import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";
import { CATEGORIES } from "./scripts/resources";

// Los centros de acopio no salen del formulario público: se agregan como
// archivos en el repo. El permiso de escritura al repositorio ES el privilegio
// de admin, y este schema es la validación que corre en cada build.
const categoryIds = CATEGORIES.map((category) => category.id) as [string, ...string[]];

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

// Dos tipos de punto curado. Un banco de sangre no recibe insumos, así que
// `recibe` solo existe en la rama `acopio`: el schema impide describir uno como
// el otro. `tipo` es obligatorio — un discriminador no admite valor por defecto.
const centros = defineCollection({
  loader: glob({ base: "./src/content/centros", pattern: "**/*.yaml" }),
  // `.strict()` en ambas ramas: sin él, Zod descarta las llaves desconocidas en
  // silencio, así que un `recibe` en un banco de sangre — o un campo con el
  // nombre mal escrito — se perdería sin que nadie se entere.
  schema: z.discriminatedUnion("tipo", [
    z
      .object({
        tipo: z.literal("acopio"),
        /** Ids de `CATEGORIES` en resources.ts — así el filtro reusa el catálogo. */
        recibe: z.array(z.enum(categoryIds)).nonempty(),
        ...comunes,
      })
      .strict(),
    z
      .object({
        tipo: z.literal("sangre"),
        ...comunes,
      })
      .strict(),
  ]),
});

export const collections = { centros };
