-- Esquema de los reportes compartidos.
--
-- Correr tal cual en el SQL Editor del proyecto de Supabase. Lo único que no
-- está acá: Authentication -> Sign In / Providers -> habilitar
-- "Anonymous sign-ins". Sin eso, nadie puede insertar.
--
-- Los centros de acopio NO viven acá: son datos curados del repo
-- (src/content/centros/), validados en cada build.

-- El largo de cada elemento de un arreglo no se puede medir en un CHECK: no
-- admite subconsultas. Por eso la medición vive en esta función inmutable.
create or replace function public.max_text_len(arr text[])
returns integer
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select coalesce(max(char_length(x)), 0) from unnest(arr) as t(x);
$$;

create table public.reports (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  name        text not null check (char_length(name) between 1 and 120),
  -- Bounding box de Cali: corta la basura y los clics accidentales lejos.
  lat         double precision not null check (lat between 3.2 and 3.6),
  lng         double precision not null check (lng between -76.75 and -76.3),
  -- Sin el tope de largo, un solo insert podía guardar megabytes de texto que
  -- todos los visitantes se descargan al abrir el mapa.
  resources   text[] not null
              check (cardinality(resources) between 1 and 20)
              check (public.max_text_len(resources) <= 60),
  covered     text[] not null default '{}'
              check (cardinality(covered) <= 20 and public.max_text_len(covered) <= 60),
  created_at  timestamptz not null default now()
);

create index reports_created_at_idx on public.reports (created_at desc);

-- Sin esto, un DELETE llega por realtime sin la fila vieja y el resto de
-- navegadores no sabe qué marcador quitar. Con RLS activo Postgres solo manda
-- la primary key en `old` — que es justo lo que hace falta, sin filtrar nada más.
alter table public.reports replica identity full;

-- Realtime: sin esto los reportes de otros solo aparecen al recargar.
alter publication supabase_realtime add table public.reports;

alter table public.reports enable row level security;

create policy "reportes visibles para todos"
  on public.reports for select to anon, authenticated using (true);

create policy "cada quien inserta lo suyo"
  on public.reports for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "cada quien borra lo suyo"
  on public.reports for delete to authenticated
  using ((select auth.uid()) = user_id);

-- No hay policy de UPDATE a propósito. Marcar un recurso como cubierto es una
-- acción comunitaria — cualquiera que pase por la zona puede hacerlo — pero una
-- policy de UPDATE abierta dejaría reescribir el nombre y las coordenadas de un
-- reporte ajeno. Esta función toca únicamente la columna `covered`.
--
-- El tope de 50 ids no es cosmético: los ids son públicos, así que sin él una
-- sola llamada podía marcar como cubierta cada necesidad del mapa y cortar la
-- ayuda a todas las zonas a la vez. 50 sobra para la zona más densa — los
-- grupos son de 50 m de radio.
create or replace function public.set_resource_covered(
  p_ids uuid[], p_resource text, p_covered boolean
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_ids is null or cardinality(p_ids) = 0 then
    return;
  end if;

  if cardinality(p_ids) > 50 then
    raise exception 'demasiados reportes en una sola llamada (máx. 50)'
      using errcode = '22023';
  end if;

  if p_resource is null or char_length(p_resource) > 60 then
    raise exception 'recurso inválido' using errcode = '22023';
  end if;

  update public.reports r
     set covered = case
           when p_covered then array(select distinct unnest(r.covered || array[p_resource]))
           else array_remove(r.covered, p_resource)
         end
   where r.id = any(p_ids)
     and p_resource = any(r.resources);
end;
$$;

-- Supabase concede EXECUTE a anon y authenticated por default privileges al
-- crear la función, así que `revoke from public` no alcanza: hay que quitarle
-- el permiso a `anon` por nombre. La app siempre abre sesión anónima, que da el
-- rol `authenticated`; nadie legítimo llama esto como `anon`.
revoke all on function public.set_resource_covered(uuid[], text, boolean) from public;
revoke execute on function public.set_resource_covered(uuid[], text, boolean) from anon;
grant execute on function public.set_resource_covered(uuid[], text, boolean) to authenticated;
