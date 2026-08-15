-- Delta sobre `20260815-centros-municipio.sql`. `supabase/schema.sql` sigue
-- siendo la foto completa que corre un proyecto nuevo de un solo pegado; esto es
-- lo único que hay que correr en el proyecto que ya está arriba.
--
-- Se puede correr dos veces sin romper nada: todo va con `if not exists` o
-- `create or replace`, y la publicación se toca solo si falta.
--
-- Qué cambia: una tabla nueva, `stats`, con las cifras de la emergencia. Es la
-- primera del proyecto cuyas filas son afirmaciones sobre el mundo y no sobre
-- sus propios usuarios, y por eso es también la de menor superficie de
-- escritura: **no tiene policy de insert, ni de update, ni de delete**. Solo
-- `service_role`, o sea un mantenedor en el editor de SQL.
--
-- Una fila es un corte entero. La UNGRD publica un balance nuevo casi cada día
-- —239 el 12 de agosto, 273 el 13, 294 el 15— y a veces más de uno el mismo día,
-- así que juntar dos cortes en una tabla sola sería inventar una consistencia
-- que nadie publicó. Guardando el corte completo en `figures`, ninguna consulta
-- puede mezclarlos: la fila *es* el corte.
--
-- No hay columna que diga de qué tipo es el corte. Cada uno trae las llaves que
-- publicó y las que no, no están: el balance del 15 no trae desglose por
-- departamento y el del 13 sí, y eso alcanza para que la página muestre cada
-- bloque con su propia fecha.

create table if not exists public.stats (
  id          text primary key check (id ~ '^[a-z0-9-]{3,60}$'),
  source      text not null check (char_length(source) between 2 and 60),
  source_url  text check (source_url is null or char_length(source_url) <= 300),
  -- El corte que estampó la fuente, no cuándo se escribió la fila.
  cut_at      timestamptz not null,
  -- Las llaves son ids del catálogo de `src/scripts/stats.ts`. Se valida que sea
  -- un objeto y nada más, igual que `centers.donations` se valida por largo y no
  -- por contenido: el catálogo vive en el repo y crece sin migración.
  figures     jsonb not null check (jsonb_typeof(figures) = 'object'),
  created_at  timestamptz not null default now()
);

create index if not exists stats_cut_idx on public.stats (cut_at desc);

alter table public.stats replica identity full;
alter table public.stats enable row level security;

do $$
begin
  alter publication supabase_realtime add table public.stats;
exception
  when duplicate_object then null;
end;
$$;

drop policy if exists "stats are public" on public.stats;
create policy "stats are public"
  on public.stats for select to anon, authenticated using (true);

-- No hay más policies, y esa es la superficie de escritura entera: ninguna. Un
-- número equivocado acá es desinformación en una página de emergencia, que no es
-- lo mismo que un pin equivocado, así que el navegador no escribe ni corrige.
