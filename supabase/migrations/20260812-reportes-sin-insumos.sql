-- Delta sobre `schema.sql`, que sigue siendo la foto completa de un proyecto
-- nuevo. Esto es lo único que hay que correr en el proyecto que ya está arriba.
--
-- Se puede correr dos veces sin romper nada: el `drop` va con `if exists` y el
-- CHECK dentro de un bloque que atrapa el duplicado.

/* ================================================================== */
/* Un reporte puede no pedir nada                                      */
/* ================================================================== */

-- Quien está parado frente a un edificio afectado sabe la dirección y sabe que
-- algo pasa, pero todavía no la lista de lo que falta. Exigir un insumo para
-- poder reportar perdía el reporte entero. La dirección es lo único obligatorio:
-- el punto entra al mapa y los insumos los agrega cualquiera después —los chips
-- ya son comunitarios (`set_resource_covered`).
--
-- El tope de veinte se queda: sin él un solo insert guarda megabytes que todos
-- los visitantes se descargan al abrir el mapa. El de largo por ítem vive en
-- `reports_resources_len_check` y no se toca acá.
alter table public.reports drop constraint if exists reports_resources_check;

do $$ begin
  alter table public.reports add constraint reports_resources_check
    check (cardinality(resources) <= 20);
exception when duplicate_object then null; end $$;
