-- Delta sobre el esquema inicial. `supabase/schema.sql` sigue siendo la foto
-- completa que corre un proyecto nuevo de un solo pegado; esto es lo único que
-- hay que correr en el proyecto que ya está arriba.
--
-- Se puede correr dos veces sin romper nada: todo va con `if not exists`, con
-- `create or replace` o dentro de un bloque que atrapa el duplicado.

/* ================================================================== */
/* 1. El reporte gana estado, nota y contacto                          */
/* ================================================================== */

alter table public.reports
  add column if not exists status        text not null default 'activo',
  -- Cuándo se tocó el estado. Es la mitad de «actualizado hace X»; la otra
  -- mitad son las novedades. Sin esto, un punto reportado hace tres días y
  -- confirmado hace diez minutos se ve igual de viejo que uno abandonado.
  add column if not exists status_at     timestamptz not null default now(),
  -- Quién lo cambió. No se muestra: es el rastro para revertir en bloque si
  -- alguien se dedica a cerrar puntos ajenos.
  add column if not exists status_by     uuid,
  add column if not exists note          text,
  add column if not exists contact_name  text,
  add column if not exists contact_phone text;

-- `add constraint if not exists` no existe en Postgres; el bloque atrapa el
-- duplicado para que el archivo se pueda correr dos veces.
do $$ begin
  alter table public.reports add constraint reports_status_check
    check (status in ('activo','urgente','saturado','cerrado'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.reports add constraint reports_note_check
    check (note is null or char_length(note) between 1 and 200);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.reports add constraint reports_contact_name_check
    check (contact_name is null or char_length(contact_name) between 2 and 60);
exception when duplicate_object then null; end $$;

-- El patrón no valida un teléfono real: corta que la casilla se use como
-- segundo campo de texto libre, que es en lo que se convierte si solo se le
-- pone un tope de largo.
do $$ begin
  alter table public.reports add constraint reports_contact_phone_check
    check (contact_phone is null or contact_phone ~ '^[0-9+][0-9 ()+-]{6,19}$');
exception when duplicate_object then null; end $$;

-- Un teléfono sin nombre no le sirve a nadie: no se sabe por quién preguntar.
do $$ begin
  alter table public.reports add constraint reports_contact_pair_check
    check (contact_phone is null or contact_name is not null);
exception when duplicate_object then null; end $$;

/* ================================================================== */
/* 2. Cambiar el estado: comunitario, por RPC — igual que «cubierto»    */
/* ================================================================== */

-- Mismo razonamiento que set_resource_covered: cualquiera que pase por la zona
-- sabe si el punto está saturado, pero una policy de UPDATE abierta dejaría
-- reescribir nombre y coordenadas ajenas. Esta función toca tres columnas y
-- ninguna de ellas es contenido de nadie más.
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

  -- Los ids son públicos: sin tope, una sola llamada cierra el mapa entero.
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
/* 3. Novedades — bitácora corta, en orden, sin edición                 */
/* ================================================================== */

create table if not exists public.updates (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  -- Nula = novedad general de la ciudad. Con reporte = se cuelga de ese punto y
  -- alimenta su «actualizado hace X».
  report_id  uuid references public.reports on delete cascade,
  body       text not null check (char_length(body) between 3 and 280),
  created_at timestamptz not null default now()
);

create index if not exists updates_created_at_idx on public.updates (created_at desc);
create index if not exists updates_report_id_idx  on public.updates (report_id);

alter table public.updates replica identity full;
alter table public.updates enable row level security;

do $$ begin
  alter publication supabase_realtime add table public.updates;
exception when duplicate_object then null; end $$;

drop policy if exists "novedades visibles para todos" on public.updates;
create policy "novedades visibles para todos"
  on public.updates for select to anon, authenticated using (true);

drop policy if exists "cada quien publica lo suyo" on public.updates;
create policy "cada quien publica lo suyo"
  on public.updates for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "cada quien borra su novedad" on public.updates;
create policy "cada quien borra su novedad"
  on public.updates for delete to authenticated
  using ((select auth.uid()) = user_id);

-- Sin policy de UPDATE, y acá no hay RPC que la reemplace: una bitácora que se
-- puede reescribir deja de ser bitácora. Si una novedad quedó mal, se borra y
-- se publica otra.

/* ================================================================== */
/* 4. Ayuda disponible — lo que alguien tiene y todavía no sabe adónde  */
/* ================================================================== */

create table if not exists public.offers (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users on delete cascade,
  title         text not null check (char_length(title) between 3 and 80),
  detail        text check (detail is null or char_length(detail) <= 200),
  -- Id de categoría de resources.ts. Se valida solo el largo, igual que
  -- `resources`: el catálogo vive en el repo y crece sin migración. La UI pinta
  -- gris lo que no reconoce (OTHER_CHIP), que ya es el comportamiento actual.
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

create index if not exists offers_created_at_idx on public.offers (created_at desc);
create index if not exists offers_report_id_idx  on public.offers (report_id);

alter table public.offers replica identity full;
alter table public.offers enable row level security;

do $$ begin
  alter publication supabase_realtime add table public.offers;
exception when duplicate_object then null; end $$;

drop policy if exists "ofertas visibles para todos" on public.offers;
create policy "ofertas visibles para todos"
  on public.offers for select to anon, authenticated using (true);

drop policy if exists "cada quien ofrece lo suyo" on public.offers;
create policy "cada quien ofrece lo suyo"
  on public.offers for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "cada quien retira su oferta" on public.offers;
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
/* 5. Freno de inserciones                                             */
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
-- `/rest/v1/rpc/throttle_inserts` como `security definer`, que es justo lo que
-- el linter de Supabase marca.
revoke all     on function public.throttle_inserts() from public;
revoke execute on function public.throttle_inserts() from anon;
revoke execute on function public.throttle_inserts() from authenticated;

drop trigger if exists reports_throttle on public.reports;
create trigger reports_throttle before insert on public.reports
  for each row execute function public.throttle_inserts(6);

drop trigger if exists updates_throttle on public.updates;
create trigger updates_throttle before insert on public.updates
  for each row execute function public.throttle_inserts(10);

drop trigger if exists offers_throttle on public.offers;
create trigger offers_throttle before insert on public.offers
  for each row execute function public.throttle_inserts(4);

-- El trigger cuenta por autor y por minuto: sin estos índices es un seq scan
-- en cada inserción.
create index if not exists reports_user_created_idx on public.reports (user_id, created_at desc);
create index if not exists updates_user_created_idx on public.updates (user_id, created_at desc);
create index if not exists offers_user_created_idx  on public.offers  (user_id, created_at desc);
