-- Esquema completo de las tres tablas escribibles: reportes, novedades y
-- ofertas de ayuda.
--
-- Este archivo es la FOTO COMPLETA: se corre tal cual en el SQL Editor de un
-- proyecto nuevo. Para un proyecto que ya está arriba no se corre esto, sino el
-- delta de `supabase/migrations/`.
--
-- Lo único que no está acá: Authentication -> Sign In / Providers -> habilitar
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

/* ================================================================== */
/* Reportes — un edificio afectado y lo que necesita                   */
/* ================================================================== */

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
  -- Estado del punto. Comunitario: lo cambia cualquiera por RPC (ver abajo).
  status      text not null default 'activo'
              check (status in ('activo','urgente','saturado','cerrado')),
  -- Cuándo se tocó el estado. Es la mitad de «actualizado hace X»; la otra
  -- mitad son las novedades. Sin esto, un punto reportado hace tres días y
  -- confirmado hace diez minutos se ve igual de viejo que uno abandonado.
  status_at   timestamptz not null default now(),
  -- Quién lo cambió. No se muestra: es el rastro para revertir en bloque si
  -- alguien se dedica a cerrar puntos ajenos.
  status_by   uuid,
  -- Lo que no cabe en el catálogo de recursos: «NO más agua, sí hidratantes».
  note        text check (note is null or char_length(note) between 1 and 200),
  contact_name  text check (contact_name is null or char_length(contact_name) between 2 and 60),
  -- El patrón no valida un teléfono real: corta que la casilla se use como
  -- segundo campo de texto libre, que es en lo que se convierte si solo se le
  -- pone un tope de largo.
  contact_phone text check (contact_phone is null or contact_phone ~ '^[0-9+][0-9 ()+-]{6,19}$'),
  -- Un teléfono sin nombre no le sirve a nadie: no se sabe por quién preguntar.
  check (contact_phone is null or contact_name is not null),
  created_at  timestamptz not null default now()
);

create index reports_created_at_idx on public.reports (created_at desc);
-- El freno de inserciones cuenta por autor y por minuto.
create index reports_user_created_idx on public.reports (user_id, created_at desc);

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
-- reporte ajeno. Estas funciones tocan únicamente las columnas comunitarias.
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

-- Mismo razonamiento, para el estado del punto: quien pasa por la zona sabe si
-- está saturado, pero no debe poder reescribir el reporte de otro.
create or replace function public.set_report_status(p_ids uuid[], p_status text)
returns void
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

  if p_status is null
     or p_status not in ('activo','urgente','saturado','cerrado') then
    raise exception 'estado inválido' using errcode = '22023';
  end if;

  update public.reports r
     set status    = p_status,
         status_at = now(),
         status_by = auth.uid()
   where r.id = any(p_ids)
     -- Sin esto, re-marcar un estado que ya estaba refresca `status_at` y el
     -- punto parece confirmado cuando nadie fue a mirar.
     and r.status is distinct from p_status;
end;
$$;

revoke all     on function public.set_report_status(uuid[], text) from public;
revoke execute on function public.set_report_status(uuid[], text) from anon;
grant  execute on function public.set_report_status(uuid[], text) to authenticated;

/* ================================================================== */
/* Novedades — bitácora corta, en orden, sin edición                   */
/* ================================================================== */

create table public.updates (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  -- Nula = novedad general de la ciudad. Con reporte = se cuelga de ese punto y
  -- alimenta su «actualizado hace X».
  report_id  uuid references public.reports on delete cascade,
  body       text not null check (char_length(body) between 3 and 280),
  created_at timestamptz not null default now()
);

create index updates_created_at_idx  on public.updates (created_at desc);
create index updates_report_id_idx   on public.updates (report_id);
create index updates_user_created_idx on public.updates (user_id, created_at desc);

alter table public.updates replica identity full;
alter table public.updates enable row level security;
alter publication supabase_realtime add table public.updates;

create policy "novedades visibles para todos"
  on public.updates for select to anon, authenticated using (true);

create policy "cada quien publica lo suyo"
  on public.updates for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "cada quien borra su novedad"
  on public.updates for delete to authenticated
  using ((select auth.uid()) = user_id);

-- Sin policy de UPDATE, y acá no hay RPC que la reemplace: una bitácora que se
-- puede reescribir deja de ser bitácora. Si una novedad quedó mal, se borra y
-- se publica otra.

/* ================================================================== */
/* Ayuda disponible — lo que alguien tiene y todavía no sabe adónde    */
/* ================================================================== */

create table public.offers (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users on delete cascade,
  title         text not null check (char_length(title) between 3 and 80),
  detail        text check (detail is null or char_length(detail) <= 200),
  -- Id de categoría de resources.ts. Se valida solo el largo, igual que
  -- `resources`: el catálogo vive en el repo y crece sin migración. La UI pinta
  -- gris lo que no reconoce.
  category      text check (category is null or char_length(category) <= 30),
  -- Acá el contacto NO es opcional: una oferta sin a quién llamar no se puede
  -- despachar, y quien la publica ya decidió exponerse al publicarla.
  contact_name  text not null check (char_length(contact_name) between 2 and 60),
  contact_phone text not null check (contact_phone ~ '^[0-9+][0-9 ()+-]{6,19}$'),
  -- `set null` y no `cascade`: si el punto desaparece, la maquinaria sigue
  -- disponible, solo se queda otra vez sin destino.
  report_id     uuid references public.reports on delete set null,
  assigned_at   timestamptz,
  created_at    timestamptz not null default now()
);

create index offers_created_at_idx  on public.offers (created_at desc);
create index offers_report_id_idx   on public.offers (report_id);
create index offers_user_created_idx on public.offers (user_id, created_at desc);

alter table public.offers replica identity full;
alter table public.offers enable row level security;
alter publication supabase_realtime add table public.offers;

create policy "ofertas visibles para todos"
  on public.offers for select to anon, authenticated using (true);

create policy "cada quien ofrece lo suyo"
  on public.offers for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "cada quien retira su oferta"
  on public.offers for delete to authenticated
  using ((select auth.uid()) = user_id);

-- Asignar una oferta a un punto es comunitario — quien coordina en la calle no
-- es quien publicó la retroexcavadora — así que va por RPC y no por UPDATE, que
-- dejaría reescribir el teléfono de otro.
create or replace function public.assign_offer(p_offer uuid, p_report uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_offer is null then
    return;
  end if;

  if p_report is not null
     and not exists (select 1 from public.reports where id = p_report) then
    raise exception 'el reporte no existe' using errcode = '22023';
  end if;

  update public.offers o
     set report_id   = p_report,
         assigned_at = case when p_report is null then null else now() end
   where o.id = p_offer;
end;
$$;

revoke all     on function public.assign_offer(uuid, uuid) from public;
revoke execute on function public.assign_offer(uuid, uuid) from anon;
grant  execute on function public.assign_offer(uuid, uuid) to authenticated;

/* ================================================================== */
/* Freno de inserciones                                                */
/* ================================================================== */

-- Tres tablas abiertas a escritura anónima. Los CHECK acotan el tamaño de una
-- fila; esto acota el ritmo. No frena a alguien decidido — puede pedir sesiones
-- anónimas nuevas — pero sí frena el script tonto y el dedo pegado en «enviar».
-- `security definer` para poder contar las filas propias sin depender de RLS.
create or replace function public.throttle_inserts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  limite    integer := coalesce(tg_argv[0]::integer, 10);
  recientes integer;
begin
  execute format(
    'select count(*)::int from public.%I where user_id = $1 and created_at > now() - interval ''1 minute''',
    tg_table_name
  ) into recientes using new.user_id;

  if recientes >= limite then
    raise exception 'demasiadas publicaciones seguidas; espera un minuto'
      using errcode = '22023';
  end if;

  return new;
end;
$$;

-- Es una función de trigger, no una RPC: el trigger corre como dueño de la
-- tabla y no necesita el grant. Sin estos revokes queda publicada en
-- `/rest/v1/rpc/throttle_inserts` como `security definer`.
revoke all     on function public.throttle_inserts() from public;
revoke execute on function public.throttle_inserts() from anon;
revoke execute on function public.throttle_inserts() from authenticated;

create trigger reports_throttle before insert on public.reports
  for each row execute function public.throttle_inserts(6);

create trigger updates_throttle before insert on public.updates
  for each row execute function public.throttle_inserts(10);

create trigger offers_throttle before insert on public.offers
  for each row execute function public.throttle_inserts(4);
