-- Full schema. Three tables anyone can write to — reports, updates, offers —
-- plus `centros`, the curated donation points, which everyone reads and only a
-- maintainer with `service_role` writes.
--
-- Este archivo es la FOTO COMPLETA: se corre tal cual en el SQL Editor de un
-- proyecto nuevo. Para un proyecto que ya está arriba no se corre esto, sino el
-- delta de `supabase/migrations/`.
--
-- Lo único que no está acá: Authentication -> Sign In / Providers -> habilitar
-- "Anonymous sign-ins". Sin eso, nadie puede insertar.

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
  -- La dirección: es lo que lleva a alguien hasta el punto.
  name        text not null check (char_length(name) between 1 and 120),
  -- Cómo se llama el sitio —«Conjunto Los Alcázares», «Colegio San José»—, que
  -- es lo que la gente dice por teléfono pero no aparece en ninguna
  -- nomenclatura. Opcional: sin dirección no se llega, sin nombre sí.
  place_name  text check (place_name is null or char_length(place_name) between 1 and 120),
  -- Bounding box de Colombia: corta la basura y los clics accidentales lejos,
  -- pero deja reportar fuera de Cali. La emergencia no se queda en una ciudad y
  -- la caja vieja —solo Cali— rechazaba un punto de Buga en la base de datos.
  lat         double precision not null check (lat between -4.3 and 13.5),
  lng         double precision not null check (lng between -82.0 and -66.8),
  -- Sin el tope de largo, un solo insert podía guardar megabytes de texto que
  -- todos los visitantes se descargan al abrir el mapa.
  --
  -- Vacío se permite a propósito: quien reporta desde la calle sabe la dirección
  -- antes que la lista de lo que falta, y los insumos los agrega cualquiera
  -- después. La dirección es lo único obligatorio de un reporte.
  resources   text[] not null
              check (cardinality(resources) <= 20)
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
/* Puntos de donación — curados, de lectura pública                    */
/* ================================================================== */

-- Los puntos de donación. Dos orígenes en una sola tabla, y `origen` los separa:
-- los curados los edita un maintainer en el editor de tablas, que corre como
-- `service_role` y se salta RLS; los comunitarios los registra cualquiera desde
-- el formulario. Ninguno de los dos se puede editar desde el navegador — no hay
-- policy de UPDATE — así que un punto curado sigue siendo intocable.
--
-- Antes eran archivos YAML en src/content/centros/ validados por Zod en el
-- build; el rebuild que exigía cada corrección era el problema, así que los
-- CHECK de acá se quedaron con lo que garantizaba el esquema.
create table public.centros (
  -- Slug para los curados: es el nombre del YAML viejo, sobrevivió a la
  -- migración y deja distinguir las filas en el editor de tablas. Un punto
  -- comunitario trae un uuid, que son 36 caracteres de hex y guiones y pasan
  -- este mismo patrón sin tocarlo.
  id          text primary key check (id ~ '^[a-z0-9-]{3,60}$'),
  tipo        text not null check (tipo in ('acopio','albergue','sangre')),
  -- Quién lo publicó. El formulario solo registra acopios: los albergues y los
  -- bancos de sangre siguen siendo curados (ver la policy de insert).
  origen      text not null default 'curado' check (origen in ('curado','comunidad')),
  -- Autor del punto comunitario, para que pueda borrar el suyo. Los curados no
  -- tienen autor: los publica el editor de tablas, no una sesión.
  user_id     uuid references auth.users on delete cascade,
  name        text not null check (char_length(name) between 3 and 120),
  direccion   text not null check (char_length(direccion) between 3 and 200),
  -- Mismo bounding box de Colombia que los reportes.
  lat         double precision not null check (lat between -4.3 and 13.5),
  lng         double precision not null check (lng between -82.0 and -66.8),
  -- Empty string is a real value here: a point whose opening hours nobody has
  -- confirmed yet. The popup just leaves the line blank.
  horario     text not null default '' check (char_length(horario) <= 120),
  telefono    text check (telefono is null or char_length(telefono) <= 40),
  notas       text check (notas is null or char_length(notas) <= 300),
  -- Nombres de insumo del catálogo de `src/scripts/resources.ts`, los mismos de
  -- `reports.resources`: lo que se pide y lo que se ofrece se nombran igual, así
  -- que se pueden comparar ítem por ítem. Se valida por largo, no por contenido
  -- —el catálogo vive en el repo y crece sin migración—; la UI agrupa cada
  -- nombre bajo su categoría y pinta gris lo que no reconoce.
  recibe      text[] not null default '{}'
              constraint centros_recibe_largo
              check (public.max_text_len(recibe) <= 60),
  -- `false` = still open, not taking supplies right now (warehouse full). It
  -- stays on the map in grey; closing for real is `activo = false`.
  recibiendo  boolean not null default true,
  nota_estado text check (nota_estado is null or char_length(nota_estado) <= 200),
  -- The last time somebody said this point is still open. A community
  -- collection center publishes with no maintainer behind it and nothing ever
  -- retires it, so a day without a confirmation is read in the browser as
  -- expired — `EXPIRY_HOURS` in `src/scripts/centros.ts` is the threshold, and
  -- it lives there and not here: the map greys the point out like a pause, and
  -- `confirm_centro` brings it back. Every other row carries the column and ignores it — a curated
  -- point is somebody's to keep, and a shelter is not the improvised thing that
  -- opens for an afternoon.
  confirmed_at timestamptz not null default now(),
  activo      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  -- The discriminated union src/content.config.ts used to enforce: a blood bank
  -- takes no supplies and must not list any, everything else must list one. The
  -- ceiling is the whole catalog: a warehouse can and does take everything.
  constraint centros_recibe_por_tipo check (
    case when tipo = 'sangre' then cardinality(recibe) = 0
         else cardinality(recibe) between 1 and 80 end
  ),
  -- Un punto curado no tiene autor; uno comunitario tiene exactamente uno. Sin
  -- esto, un `user_id` nulo en una fila comunitaria la volvería imborrable.
  constraint centros_origen_autor check (
    (origen = 'curado'    and user_id is null) or
    (origen = 'comunidad' and user_id is not null)
  )
);

-- The client only ever asks for the active ones.
create index centros_activo_idx on public.centros (activo);
-- El freno de inserciones cuenta por autor y por minuto.
create index centros_user_created_idx on public.centros (user_id, created_at desc);

alter table public.centros replica identity full;
alter table public.centros enable row level security;
alter publication supabase_realtime add table public.centros;

create policy "puntos visibles para todos"
  on public.centros for select to anon, authenticated using (true);

-- Toda la superficie de escritura de la tabla, y es a propósito así de estrecha:
-- solo un acopio, solo `origen = 'comunidad'`, solo a nombre de quien inserta.
-- Un punto curado no se puede crear desde el navegador ni por accidente ni a
-- propósito — el editor de tablas sigue siendo la única vía.
create policy "la comunidad registra acopios"
  on public.centros for insert to authenticated
  with check (
    origen = 'comunidad'
    and tipo = 'acopio'
    and activo
    and (select auth.uid()) = user_id
  );

-- Espejo de `reports`: cada quien borra lo suyo, y lo curado no lo borra nadie.
create policy "cada quien borra su punto"
  on public.centros for delete to authenticated
  using (origen = 'comunidad' and (select auth.uid()) = user_id);

-- Sigue sin haber policy de UPDATE. Corregir un punto ajeno —o el propio— es
-- una edición completa de la fila: nombre, coordenadas y horario a la vez. Lo
-- comunitario se resuelve como en las otras tablas, con una RPC de una sola
-- columna: `confirmed_at`, y nada más.

-- Anyone can say a community point is still open, the same way anyone can mark
-- a resource covered: whoever walks past knows, and the author cannot be the
-- one to answer — their session is anonymous and dies with the browser storage,
-- which would strand the point as expired forever.
--
-- It refuses to touch `recibiendo`: a maintainer who paused a point paused it
-- for a reason, and confirming that the place exists is not the same claim as
-- confirming it is taking donations again.
create or replace function public.confirm_centro(p_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_id is null or char_length(p_id) > 60 then
    raise exception 'punto inválido' using errcode = '22023';
  end if;

  update public.centros c
     set confirmed_at = now()
   where c.id = p_id
     -- Lo mismo que vence en el navegador, y nada más: un punto curado no vence
     -- así que tampoco se confirma, un albergue comunitario tampoco —ahí duerme
     -- gente— y uno cerrado (`activo = false`) no vuelve por esta vía.
     and c.tipo = 'acopio'
     and c.origen = 'comunidad'
     and c.activo;
end;
$$;

revoke all     on function public.confirm_centro(text) from public;
revoke execute on function public.confirm_centro(text) from anon;
grant  execute on function public.confirm_centro(text) to authenticated;

-- `updated_at` is the maintainer's own trail — which point was touched last
-- time the city changed. The other tables have no UPDATE path, so this trigger
-- has no equivalent to reuse.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function public.touch_updated_at() from public;

create trigger centros_touch_updated_at before update on public.centros
  for each row execute function public.touch_updated_at();

/* ================================================================== */
/* Freno de inserciones                                                */
/* ================================================================== */

-- Cuatro tablas abiertas a escritura anónima. Los CHECK acotan el tamaño de una
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

-- El más bajo de los cuatro: un punto de acopio es una respuesta, no un reporte,
-- y nadie abre tres bodegas en un minuto. Cuenta por `user_id`, así que las
-- filas curadas —sin autor— nunca entran en la cuenta.
create trigger centros_throttle before insert on public.centros
  for each row execute function public.throttle_inserts(3);
