-- Delta sobre `schema.sql`, que sigue siendo la foto completa de un proyecto
-- nuevo. Esto es lo único que hay que correr en el proyecto que ya está arriba.
--
-- Se puede correr dos veces sin romper nada: la columna va con `if not exists` y
-- el CHECK dentro de un bloque que atrapa el duplicado.

/* ================================================================== */
/* El reporte gana el nombre del lugar                                 */
/* ================================================================== */

-- `name` es la dirección: es lo que lleva a alguien hasta el punto, y por eso
-- sigue siendo obligatorio y el que encabeza el popup. Esto es cómo se llama el
-- sitio —«Conjunto Los Alcázares», «Colegio San José»—, que es lo que la gente
-- dice por teléfono pero no aparece en ninguna nomenclatura.
alter table public.reports
  add column if not exists place_name text;

-- `add constraint if not exists` no existe en Postgres; el bloque atrapa el
-- duplicado para que el archivo se pueda correr dos veces.
do $$ begin
  alter table public.reports add constraint reports_place_name_check
    check (place_name is null or char_length(place_name) between 1 and 120);
exception when duplicate_object then null; end $$;
