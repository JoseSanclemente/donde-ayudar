-- Delta over `20260812-centros-vigencia.sql`. `supabase/schema.sql` stays the
-- full snapshot a new project runs in one paste; this is the only thing to run
-- on the project already up. It can be run twice: every rename is guarded.
--
-- `centros` becomes `centers` and every column is English. `healthcare` joins
-- the three types. `telefono` splits into `contact_whatsapp` and
-- `contact_instagram`. The donations list is optional for every type.
-- `confirmed_at` and `nota_estado` are gone: `updated_at` carries the expiry
-- clock, `is_active` greys the marker, `accepting_donations` writes the line in
-- the popup, and retiring a point for good is deleting the row.

/* ================================================================== */
/* 1. Table, columns, constraints, indexes, triggers                   */
/* ================================================================== */

do $$
begin
  if to_regclass('public.centros') is not null then
    alter table public.centros rename to centers;
  end if;
end $$;

do $$
declare
  pair record;
begin
  for pair in
    select * from (values
      ('tipo',       'type'),
      ('origen',     'origin'),
      ('direccion',  'address'),
      ('horario',    'hours'),
      ('telefono',   'contact_whatsapp'),
      ('notas',      'notes'),
      ('recibe',     'donations'),
      ('recibiendo', 'accepting_donations'),
      ('activo',     'is_active')
    ) as p(old_name, new_name)
  loop
    if exists (
      select 1 from information_schema.columns
       where table_schema = 'public'
         and table_name = 'centers'
         and column_name = pair.old_name
    ) then
      execute format(
        'alter table public.centers rename column %I to %I', pair.old_name, pair.new_name
      );
    end if;
  end loop;
end $$;

do $$
declare
  pair record;
begin
  for pair in
    select * from (values
      ('centros_pkey',            'centers_pkey'),
      ('centros_user_id_fkey',    'centers_user_id_fkey'),
      ('centros_id_check',        'centers_id_check'),
      ('centros_name_check',      'centers_name_check'),
      ('centros_direccion_check', 'centers_address_check'),
      ('centros_lat_check',       'centers_lat_check'),
      ('centros_lng_check',       'centers_lng_check'),
      ('centros_horario_check',   'centers_hours_check'),
      ('centros_telefono_check',  'centers_contact_whatsapp_check'),
      ('centros_notas_check',     'centers_notes_check'),
      ('centros_origen_check',    'centers_origin_check'),
      ('centros_origen_autor',    'centers_origin_author'),
      ('centros_recibe_largo',    'centers_donations_len')
    ) as p(old_name, new_name)
  loop
    if exists (
      select 1 from pg_constraint
       where conrelid = 'public.centers'::regclass and conname = pair.old_name
    ) then
      execute format(
        'alter table public.centers rename constraint %I to %I', pair.old_name, pair.new_name
      );
    end if;
  end loop;
end $$;

alter index if exists public.centros_activo_idx rename to centers_active_idx;
alter index if exists public.centros_user_created_idx rename to centers_user_created_idx;

do $$
begin
  if exists (
    select 1 from pg_trigger
     where tgrelid = 'public.centers'::regclass and tgname = 'centros_touch_updated_at'
  ) then
    alter trigger centros_touch_updated_at on public.centers
      rename to centers_touch_updated_at;
  end if;

  if exists (
    select 1 from pg_trigger
     where tgrelid = 'public.centers'::regclass and tgname = 'centros_throttle'
  ) then
    alter trigger centros_throttle on public.centers rename to centers_throttle;
  end if;
end $$;

/* ================================================================== */
/* 2. The fourth type, and donations for all of them                   */
/* ================================================================== */

alter table public.centers drop constraint if exists centros_tipo_check;
alter table public.centers drop constraint if exists centers_type_check;
alter table public.centers
  add constraint centers_type_check
  check (type in ('acopio','albergue','sangre','healthcare'));

alter table public.centers drop constraint if exists centros_recibe_por_tipo;
alter table public.centers drop constraint if exists centers_donations_max;
alter table public.centers
  add constraint centers_donations_max check (cardinality(donations) <= 80);

/* ================================================================== */
/* 3. Contact                                                          */
/* ================================================================== */

alter table public.centers
  add column if not exists contact_instagram text
  constraint centers_contact_instagram_check
  check (contact_instagram is null or char_length(contact_instagram) <= 40);

/* ================================================================== */
/* 4. `updated_at` takes over the expiry clock                         */
/* ================================================================== */

do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'centers' and column_name = 'confirmed_at'
  ) then
    -- Without disabling it, the trigger stamps `now()` over the value being
    -- restored and every community point reads as freshly confirmed.
    alter table public.centers disable trigger centers_touch_updated_at;

    update public.centers set updated_at = confirmed_at where confirmed_at < updated_at;

    alter table public.centers enable trigger centers_touch_updated_at;
    alter table public.centers drop column confirmed_at;
  end if;
end $$;

alter table public.centers drop constraint if exists centros_nota_estado_check;
alter table public.centers drop column if exists nota_estado;

/* ================================================================== */
/* 5. Policies and the confirm RPC                                     */
/* ================================================================== */

drop policy if exists "puntos visibles para todos"    on public.centers;
drop policy if exists "la comunidad registra acopios" on public.centers;
drop policy if exists "cada quien borra su punto"     on public.centers;

drop policy if exists "centers are public"                       on public.centers;
drop policy if exists "the community registers collection points" on public.centers;
drop policy if exists "authors delete their own center"          on public.centers;

create policy "centers are public"
  on public.centers for select to anon, authenticated using (true);

-- The whole write surface of the table, this narrow on purpose: a collection
-- point, community origin, in the name of whoever inserts it. The other three
-- types are a maintainer's, written with SQL.
create policy "the community registers collection points"
  on public.centers for insert to authenticated
  with check (
    origin = 'comunidad'
    and type = 'acopio'
    and is_active
    and (select auth.uid()) = user_id
  );

create policy "authors delete their own center"
  on public.centers for delete to authenticated
  using (origin = 'comunidad' and (select auth.uid()) = user_id);

-- Anyone can say a community point is still open, the same way anyone can mark
-- a resource covered: whoever walks past knows, and the author cannot answer —
-- their anonymous session dies with the browser storage, which would strand the
-- point as expired forever. It touches `updated_at` and nothing else.
create or replace function public.confirm_center(p_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_id is null or char_length(p_id) > 60 then
    raise exception 'punto inválido' using errcode = '22023';
  end if;

  update public.centers c
     set updated_at = now()
   where c.id = p_id
     and c.type = 'acopio'
     and c.origin = 'comunidad';
end;
$$;

revoke all     on function public.confirm_center(text) from public;
revoke execute on function public.confirm_center(text) from anon;
grant  execute on function public.confirm_center(text) to authenticated;

drop function if exists public.confirm_centro(text);
