-- Full schema. Five tables anyone can write to — reports, updates, offers,
-- volunteers, pets — plus `centers`, where only a collection point can
-- be written from the browser and everything else takes a maintainer with
-- `service_role`.
--
-- This file is the FULL SNAPSHOT: it runs as is in the SQL Editor of a new
-- project. A project already up runs the delta in `supabase/migrations/`
-- instead.
--
-- The only thing not here: Authentication -> Sign In / Providers -> enable
-- "Anonymous sign-ins". Without it, nobody can insert.

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
  -- When the offer was called done; `null` while it still stands. Communal like
  -- `report_id`: whoever coordinated the delivery knows it happened, and the
  -- author lost their anonymous session a long time ago.
  finished_at   timestamptz,
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

-- Calling an offer done is communal for the same reason assigning it is: the
-- backhoe already worked, whoever published it is not watching the site, and
-- their anonymous session died with the browser storage. Without this, the
-- offer stays counted as available capacity forever.
--
-- It touches `finished_at` and nothing else: there is still no UPDATE policy on
-- the table, which would let anyone rewrite someone else's phone number.
create or replace function public.set_offer_finished(p_offer uuid, p_finished boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_offer is null or p_finished is null then
    return;
  end if;

  if not exists (select 1 from public.offers where id = p_offer) then
    raise exception 'la oferta no existe' using errcode = '22023';
  end if;

  update public.offers o
     set finished_at = case when p_finished then now() else null end
   where o.id = p_offer
     -- Re-ticking what was already ticked does not move the clock: the stamp
     -- says when the help was delivered, not when somebody touched the box.
     and (o.finished_at is not null) is distinct from p_finished;
end;
$$;

revoke all     on function public.set_offer_finished(uuid, boolean) from public;
revoke execute on function public.set_offer_finished(uuid, boolean) from anon;
grant  execute on function public.set_offer_finished(uuid, boolean) to authenticated;

/* ================================================================== */
/* Volunteers — whoever offers their own time to the community         */
/* ================================================================== */

-- `offers` in shape — anyone inserts, everyone reads, only the author withdraws
-- — with one difference: here the contact can be a WhatsApp or an Instagram, and
-- one of the two is enough. Whoever listens does not always hand out their
-- number.
--
-- One table for every panel of this kind, told apart by `kind`: «Salud mental»
-- and «Asesoría Jurídica» are the same signup with different copy, so adding a
-- third panel is a value in the CHECK and an entry in `scripts/volunteers.ts`.
create table public.volunteers (
  id                uuid primary key default gen_random_uuid(),
  kind              text not null default 'salud_mental',
  user_id           uuid not null default auth.uid() references auth.users on delete cascade,
  name              text not null check (char_length(name) between 2 and 60),
  contact_phone     text check (contact_phone is null or contact_phone ~ '^[0-9+][0-9 ()+-]{6,19}$'),
  contact_instagram text check (contact_instagram is null or contact_instagram ~ '^[A-Za-z0-9._]{1,30}$'),
  notes             text check (notes is null or char_length(notes) <= 200),
  created_at        timestamptz not null default now(),
  constraint volunteers_kind_check check (kind in ('salud_mental', 'juridica')),
  -- Whoever signs up has to be reachable: a name with no way to answer it is not
  -- a volunteer, it is a line of text.
  constraint mental_health_volunteers_contact_check
    check (contact_phone is not null or contact_instagram is not null)
);

-- The names of the first two carry the old table: they were renamed with it, and
-- renaming an index changes nothing that is read.
create index mental_health_volunteers_created_at_idx
  on public.volunteers (created_at desc);
create index mental_health_volunteers_user_created_idx
  on public.volunteers (user_id, created_at desc);
create index volunteers_kind_created_at_idx
  on public.volunteers (kind, created_at desc);

alter table public.volunteers replica identity full;
alter table public.volunteers enable row level security;
alter publication supabase_realtime add table public.volunteers;

create policy "inscripciones visibles para todas"
  on public.volunteers for select to anon, authenticated using (true);

create policy "cada quien se inscribe a sí misma"
  on public.volunteers for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "cada quien retira su inscripción"
  on public.volunteers for delete to authenticated
  using ((select auth.uid()) = user_id);

-- No UPDATE policy and no RPC: a signup either stands or is withdrawn. There is
-- nothing communal to touch on someone else's card.

/* ================================================================== */
/* Centers — donation points, shelters, blood banks, healthcare        */
/* ================================================================== */

-- Two origins in one table, and `origin` separates them: a curated center is
-- written by a maintainer with SQL, which runs as `service_role` and skips RLS;
-- a community one is registered by anyone from the form. Neither can be edited
-- from the browser — there is no UPDATE policy.
create table public.centers (
  -- A slug for the curated ones, a uuid for the community ones: 36 characters
  -- of hex and dashes, which pass this same pattern untouched.
  id          text primary key check (id ~ '^[a-z0-9-]{3,60}$'),
  type        text not null
              constraint centers_type_check
              check (type in ('acopio','albergue','sangre','healthcare')),
  -- Who published it. The form only registers collection points; the other
  -- three types are a maintainer's (see the insert policy).
  origin      text not null default 'curado'
              constraint centers_origin_check
              check (origin in ('curado','comunidad')),
  user_id     uuid references auth.users on delete cascade,
  name        text not null check (char_length(name) between 3 and 120),
  address     text not null check (char_length(address) between 3 and 200),
  -- Same Colombia bounding box as the reports.
  lat         double precision not null check (lat between -4.3 and 13.5),
  lng         double precision not null check (lng between -82.0 and -66.8),
  -- Empty string is a real value here: a point whose opening hours nobody has
  -- confirmed yet. The popup just leaves the line blank.
  hours       text not null default '' check (char_length(hours) <= 120),
  contact_whatsapp  text check (contact_whatsapp is null or char_length(contact_whatsapp) <= 40),
  -- The handle, with no `@` and no url.
  contact_instagram text check (contact_instagram is null or char_length(contact_instagram) <= 40),
  notes       text check (notes is null or char_length(notes) <= 300),
  -- Supply names from the catalog in `src/scripts/resources.ts`, the same ones
  -- `reports.resources` holds: what is asked for and what is offered are named
  -- alike, so they compare item by item. Validated by length and not by
  -- content — the catalog lives in the repo and grows without a migration.
  -- Optional for every type: a blood bank may list donations and a collection
  -- point may list none.
  donations   text[] not null default '{}'
              constraint centers_donations_len
              check (public.max_text_len(donations) <= 60)
              constraint centers_donations_max
              check (cardinality(donations) <= 80),
  -- `false` = open, not taking supplies right now (warehouse full). It only
  -- writes a line in the popup; the marker keeps its color.
  accepting_donations boolean not null default true,
  -- `false` greys the marker out. The point stays on the map: whoever saw it
  -- yesterday needs to know why not to go. Retiring it for good is deleting the
  -- row.
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  -- Also the expiry clock. A community collection point publishes with no
  -- maintainer behind it and nothing ever retires it, so a day untouched is
  -- read in the browser as expired — `EXPIRY_HOURS` in `src/scripts/centers.ts`
  -- is the threshold — and `confirm_center` brings it back. Every other row
  -- carries the column and ignores it.
  updated_at  timestamptz not null default now(),

  -- A curated point has no author; a community one has exactly one. Without
  -- this, a null `user_id` on a community row would make it undeletable.
  constraint centers_origin_author check (
    (origin = 'curado'    and user_id is null) or
    (origin = 'comunidad' and user_id is not null)
  )
);

create index centers_active_idx on public.centers (is_active);
-- The insert throttle counts per author per minute.
create index centers_user_created_idx on public.centers (user_id, created_at desc);

alter table public.centers replica identity full;
alter table public.centers enable row level security;
alter publication supabase_realtime add table public.centers;

create policy "centers are public"
  on public.centers for select to anon, authenticated using (true);

-- The whole write surface of the table, this narrow on purpose: a collection
-- point, community origin, in the name of whoever inserts it. The other three
-- types cannot be created from the browser by accident or on purpose.
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

-- There is still no UPDATE policy. Correcting a point is a full row edit —
-- name, coordinates and hours at once. The communal bit goes the same way as in
-- the other tables, through a one-column RPC.

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
     -- The same thing that expires in the browser, and nothing else: a curated
     -- point does not expire so it is not confirmed either, and neither does a
     -- community shelter — people sleep there.
     and c.type = 'acopio'
     and c.origin = 'comunidad';
end;
$$;

revoke all     on function public.confirm_center(text) from public;
revoke execute on function public.confirm_center(text) from anon;
grant  execute on function public.confirm_center(text) to authenticated;

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

create trigger centers_touch_updated_at before update on public.centers
  for each row execute function public.touch_updated_at();

/* ================================================================== */
/* Pets — an animal found in the street, and who has it                */
/* ================================================================== */

-- The smallest table of the schema: a photo, a phone and what kind of animal it
-- is. Whoever finds a pet already took the picture — the whole point of the page
-- is that the picture travels, so `photo_path` is the only mandatory thing after
-- the phone. There is no name, no address and no notes: a found dog has no
-- address, and the person looking for it recognises it or does not.
--
-- The photo itself is not here. It goes to the `pets` bucket in Storage (below)
-- and the row keeps its object key: the bytes in a column would ride along in
-- every realtime payload and in every read of the table.
create table public.pets (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users on delete cascade,
  kind          text not null,
  -- Whether it is a male or a female, which is the first thing somebody looking
  -- for their dog knows about it. Nullable and with two values only: «no sé» is
  -- a legitimate answer in front of an animal in the street and is stored as
  -- NULL, the same as a row published before this column existed. The card
  -- simply does not paint the chip.
  sex           text check (sex is null or sex in ('male', 'female')),
  -- The object key inside the bucket, not a url. The pattern is a shape check,
  -- like the phone one: it stops the column being used as free text or as a full
  -- address to somewhere else. Reading it back into a url is `data/pets.ts`.
  photo_path    text not null check (photo_path ~ '^[a-zA-Z0-9/_.-]{3,200}$'),
  -- How to write to whoever found it. No name next to it — whoever writes is
  -- asking about the animal, not about a person.
  --
  -- Two columns and not one, because WhatsApp lets a person put a username in
  -- front of their number: to the business the phone then does not exist at all
  -- —the webhook carries a business-scoped user id and the handle, and nothing
  -- else— so a phone cannot be demanded of everyone. `wa.me/<username>` opens
  -- that chat the same as a number does. The CHECK below asks for one of the two
  -- and the row is worthless without either: a photo nobody can be written about
  -- is a photo nobody can claim.
  contact_phone    text check (contact_phone ~ '^[0-9+][0-9 ()+-]{6,19}$'),
  contact_username text check (contact_username ~ '^[A-Za-z0-9._-]{3,30}$'),
  created_at    timestamptz not null default now(),
  constraint pets_kind_check check (kind in ('dog', 'cat', 'other')),
  constraint pets_contact_check
    check (contact_phone is not null or contact_username is not null)
);

create index pets_created_at_idx on public.pets (created_at desc);
-- The insert throttle counts per author per minute.
create index pets_user_created_at_idx on public.pets (user_id, created_at desc);

alter table public.pets replica identity full;
alter table public.pets enable row level security;
alter publication supabase_realtime add table public.pets;

create policy "pets are public"
  on public.pets for select to anon, authenticated using (true);

create policy "anyone publishes a pet they found"
  on public.pets for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "authors delete their own pet"
  on public.pets for delete to authenticated
  using ((select auth.uid()) = user_id);

-- No UPDATE policy, like everywhere else: the animal was returned or it was not.
-- A correction is deleting the row and publishing again with the right photo.

/* ---- The bucket the photos live in ---- */

-- Public: the photos are meant to be seen by everyone, exactly like the rows, so
-- reading needs no policy and no signed url. The mime list and the 5 MB ceiling
-- are the server-side half of what the form also checks — a phone camera hands
-- out several megabytes without asking.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('pets', 'pets', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- Writing does need policies, and they mirror the table's: anyone uploads in
-- their own name, only the owner removes. `owner` is set by Storage itself from
-- the session, so it is the same fact `user_id` carries in the row.
create policy "anyone uploads a pet photo"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'pets' and owner = (select auth.uid()));

create policy "authors delete their own pet photo"
  on storage.objects for delete to authenticated
  using (bucket_id = 'pets' and owner = (select auth.uid()));

/* ---- The waiting room of the WhatsApp intake ---- */

-- `pets` has a second writer: the `whatsapp-pets` Edge Function, which publishes
-- what people send to the WhatsApp number. A photo arrives before anyone has
-- said what animal it is — or whether it is a male or a female, and a WhatsApp
-- message carries three buttons at most — so the function asks twice and waits;
-- this is what it keeps in the meantime.
--
-- Not the photo — the Graph media id. The bytes are downloaded only after the
-- last tap, so a photo nobody finishes classifying never reaches the bucket and
-- there are no orphan objects to sweep. The rows the function sweeps itself,
-- cheaply, on any invocation: nothing classified in a day is going to be.
create table public.pet_intakes (
  id            uuid primary key default gen_random_uuid(),
  -- The dedupe. Meta resends a webhook it believes failed, and the second copy
  -- of the same message must not open a second conversation.
  wa_message_id text not null unique,
  -- Who sent it. Normally the digits Meta uses — no `+`, no spaces — and it
  -- becomes `contact_phone` on the published row. When the sender hides their
  -- phone behind a WhatsApp username there are no digits to have, and what comes
  -- instead is the business-scoped user id (`CO.1351106690554399`), which is what
  -- the function addresses its replies to. The column holds either; it is not
  -- read as a phone anywhere.
  wa_from       text not null,
  -- The handle of a sender with no phone, kept from the message that brought the
  -- photo: it becomes `contact_username` on the published row. Null for everyone
  -- else, which is almost everyone.
  wa_username   text,
  media_id      text not null,
  mime_type     text not null,
  -- What the first tap said. Null until then.
  kind          text,
  -- Which message that `kind` came from. A Meta resend of the same tap must not
  -- send the sex buttons twice; a genuine second tap must, because it is a
  -- correction, and the id is what tells them apart.
  wa_kind_message_id text,
  created_at    timestamptz not null default now()
);

create index pet_intakes_created_at_idx on public.pet_intakes (created_at desc);

-- RLS on and **not a single policy**: that is what makes the table invisible.
-- `anon` and `authenticated` get nothing, and only `service_role`, which skips
-- RLS, can see a phone number that has not agreed to being published yet. It is
-- not in `supabase_realtime` either: nothing subscribes to it.
alter table public.pet_intakes enable row level security;

/* ================================================================== */
/* Freno de inserciones                                                */
/* ================================================================== */

-- Cinco tablas abiertas a escritura anónima. Los CHECK acotan el tamaño de una
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
  -- La Edge Function de WhatsApp no es un navegador: tiene la `service_role`, o
  -- sea que podría saltarse RLS entera, y limitarla acá sería teatro. Lo que sí
  -- haría es romperla, porque todas sus filas llevan el mismo autor y la quinta
  -- mascota del minuto saldría rechazada. Se lee de los claims y no de
  -- `current_user`: esto es `security definer`, así que `current_user` es su
  -- dueño y no dice nada de quién llamó.
  if coalesce(
       nullif(current_setting('request.jwt.claim.role', true), ''),
       nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
     ) = 'service_role' then
    return new;
  end if;

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

create trigger mental_health_volunteers_throttle
  before insert on public.volunteers
  for each row execute function public.throttle_inserts(4);

-- The lowest of the four: a collection point is an answer, not a report, and
-- nobody opens three warehouses in a minute. It counts per `user_id`, so the
-- curated rows — with no author — never enter the count.
create trigger centers_throttle before insert on public.centers
  for each row execute function public.throttle_inserts(3);

-- Each row carries an upload behind it, so the ceiling is low. It only guards
-- the table: a script that uploads without inserting is the bucket's own limits
-- to stop, not this trigger's.
create trigger pets_throttle before insert on public.pets
  for each row execute function public.throttle_inserts(4);
