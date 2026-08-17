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
-- `kind` is the trade of whoever signs up, and it is a column and not a panel of
-- its own: there is one panel, the person picks their trade in it, and the
-- roster filters by it. It used to be one panel per value, with its own tab, and
-- that is what filed the signups wrong — a trade nobody had added went into
-- whichever tab was nearest. Adding one is a value here and an entry in
-- `scripts/volunteers.ts`. `otra` is the escape valve for the trade that is not
-- listed yet.
create table public.volunteers (
  id                uuid primary key default gen_random_uuid(),
  kind              text not null default 'salud_mental',
  user_id           uuid not null default auth.uid() references auth.users on delete cascade,
  name              text not null check (char_length(name) between 2 and 60),
  contact_phone     text check (contact_phone is null or contact_phone ~ '^[0-9+][0-9 ()+-]{6,19}$'),
  contact_instagram text check (contact_instagram is null or contact_instagram ~ '^[A-Za-z0-9._]{1,30}$'),
  notes             text check (notes is null or char_length(notes) <= 200),
  created_at        timestamptz not null default now(),
  constraint volunteers_kind_check
    check (kind in ('salud_mental', 'juridica', 'construccion', 'funeraria', 'otra')),
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
  -- `municipio` is the odd one and the only one that is not a door: a whole
  -- municipality asking for help, its coordinate at the cabecera, published by a
  -- maintainer out of the reporting. It is here and not in a table of its own
  -- because on the map it is the same question every other row answers — what
  -- pin, and what does it need — and `updated_at` is read as its validity
  -- anchor: 30 days (`MUNICIPIO_DAYS` in `src/scripts/centers.ts`), after which
  -- the browser stops drawing it.
  type        text not null
              constraint centers_type_check
              check (type in ('acopio','albergue','sangre','healthcare','municipio')),
  -- Who published it. The form only registers collection points; the other
  -- four types are a maintainer's (see the insert policy).
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
  -- Also the expiry clock, and it is read two different ways. A community
  -- collection point publishes with no maintainer behind it and nothing ever
  -- retires it, so a day untouched is read in the browser as expired —
  -- `EXPIRY_HOURS` in `src/scripts/centers.ts` — and `confirm_center` brings it
  -- back. A `municipio` reads the same column over 30 days (`MUNICIPIO_DAYS`)
  -- and comes off the map instead of greying, because no visitor can confirm a
  -- town: only a maintainer redoing the news sweep, with `set updated_at =
  -- now()`. Every other row carries the column and ignores it.
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
-- point, community origin, in the name of whoever inserts it. The other four
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
  -- Where the animal is: a vet, a shelter, an organization. Optional, and empty
  -- for most rows — somebody who picked a dog up in the street holds it at home
  -- and there is no place to name. It exists because the grid is also filled
  -- with pets held by institutions, and there the name is what lets whoever
  -- recognises their dog go and get it. Not an address, and not written from the
  -- browser: no field in the form and no step in the bot, only maintainer SQL and
  -- the seeder, which publishes batches that come from exactly such a place.
  place_name    text check (place_name is null or char_length(place_name) between 1 and 120),
  -- The code this pet already had in the register of whoever handed the batch
  -- over. A whole batch shares one contact, so whoever receives «Escribir al
  -- WhatsApp» cannot tell twenty messages about twenty animals apart; this is the
  -- identifier they already work with, and it comes back in the `?text=` of the
  -- button and in the link that opens the card. Only `scripts/seed-pets.mjs`
  -- writes it: a pet published from the form or from the bot has no register
  -- behind it. A shape check and not a foreign key — there is no table of
  -- external systems, and what the pattern stops is free text landing in a url.
  ref_code      text check (ref_code is null or ref_code ~ '^[A-Za-z0-9][A-Za-z0-9 _-]{2,39}$'),
  -- How to write to whoever found it. No name next to it — whoever writes is
  -- asking about the animal, not about a person.
  --
  -- Three columns and not one, because WhatsApp lets a person put a username in
  -- front of their number: to the business the phone then does not exist at all
  -- —the webhook carries a business-scoped user id and the handle, and nothing
  -- else— so a phone cannot be demanded of everyone. `wa.me/<username>` opens
  -- that chat the same as a number does. The CHECK below asks for one of the
  -- three and the row is worthless without any: a photo nobody can be written
  -- about is a photo nobody can claim.
  -- A third address, and the one a pet that came off Instagram carries: the
  -- permalink of the post it was published in, which is all there is of whoever
  -- has it — or the profile, when a whole batch came from one institution and
  -- there is no post per animal. Not `contact_instagram` — `centers` and
  -- `volunteers` keep a bare handle under that name; this keeps the whole url.
  contact_phone    text check (contact_phone ~ '^[0-9+][0-9 ()+-]{6,19}$'),
  contact_username text check (contact_username ~ '^[A-Za-z0-9._-]{3,30}$'),
  contact_instagram_url text check (contact_instagram_url ~ '^https://(www\.)?instagram\.com/((p|reel)/[A-Za-z0-9_-]{5,30}|[A-Za-z0-9._]{1,30})/?$'),
  -- Which of the four the row carries, and no identifier. The three columns
  -- above are revoked from the browser, so a card paints its button before
  -- knowing where it leads: without this it guessed WhatsApp and swapped the
  -- label when the contact arrived on hover. This is granted, and it is enough
  -- for the right label, icon and colour on the first render.
  contact_type  text generated always as (
    case
      when contact_phone is not null then 'phone'
      when contact_username is not null then 'username'
      when contact_instagram_url ~ '/(p|reel)/' then 'instagram_post'
      else 'instagram_profile'
    end
  ) stored,
  created_at    timestamptz not null default now(),
  constraint pets_kind_check check (kind in ('dog', 'cat', 'other')),
  constraint pets_contact_check
    check (contact_phone is not null
        or contact_username is not null
        or contact_instagram_url is not null)
);

create index pets_created_at_idx on public.pets (created_at desc);
-- The insert throttle counts per author per minute.
create index pets_user_created_at_idx on public.pets (user_id, created_at desc);

alter table public.pets replica identity full;
alter table public.pets enable row level security;
alter publication supabase_realtime add table public.pets;

create policy "pets are public"
  on public.pets for select to anon, authenticated using (true);

-- Every row is readable and not every column is. RLS filters rows, and what has
-- to be kept back here are three columns: the page reads two hundred pets in one
-- request, and while the contact came with them so did two hundred phone
-- numbers — never painted, the button says «Escribir al WhatsApp» and the number
-- lives in the `href`, but handed whole to anyone who asked for the table. That
-- is a list, not a contact.
--
-- So the table-level SELECT goes and comes back column by column. It has to be
-- in that order: a column cannot be revoked out of a grant made over the whole
-- table. Whoever needs a contact asks `pet_contact` for one, which is how a card
-- uses it. `service_role` is untouched — the bot and the seeder read everything.
revoke select on public.pets from anon, authenticated;

grant select (
  id,
  user_id,
  kind,
  sex,
  photo_path,
  place_name,
  ref_code,
  contact_type,
  created_at
) on public.pets to anon, authenticated;

create policy "anyone publishes a pet they found"
  on public.pets for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "authors delete their own pet"
  on public.pets for delete to authenticated
  using ((select auth.uid()) = user_id);

-- No UPDATE policy, like everywhere else: the animal was returned or it was not.
-- A correction is deleting the row and publishing again with the right photo.

-- The contact of one pet, which is the only way to reach those three columns
-- from the browser. `security definer` because the caller has no privilege on
-- them any more; no row filter because the SELECT policy above is `using (true)`
-- and a published pet is public. What changed is the price of collecting them
-- all: one request per pet instead of one request for every pet at once.
create or replace function public.pet_contact(p_id uuid)
returns table (
  contact_phone text,
  contact_username text,
  contact_instagram_url text
)
language sql
stable
security definer
set search_path = public
as $$
  select p.contact_phone, p.contact_username, p.contact_instagram_url
  from public.pets p
  where p.id = p_id;
$$;

-- `public` includes whoever should not, and unlike the rest of the functions
-- here the anonymous role does call this one: `/mascotas` opens no session.
revoke all     on function public.pet_contact(uuid) from public;
grant  execute on function public.pet_contact(uuid) to anon, authenticated;

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
  -- What the second tap said, kept for the same reason `kind` is: for a sender
  -- who has not answered the consent question yet there is one more wait after
  -- this one, and the answer has to survive it. `unknown` is «no sé», which
  -- becomes NULL on the published row and is not the same as «not answered».
  sex           text check (sex is null or sex in ('male', 'female', 'unknown')),
  wa_sex_message_id text,
  created_at    timestamptz not null default now()
);

create index pet_intakes_created_at_idx on public.pet_intakes (created_at desc);

-- RLS on and **not a single policy**: that is what makes the table invisible.
-- `anon` and `authenticated` get nothing, and only `service_role`, which skips
-- RLS, can see a phone number that has not agreed to being published yet. It is
-- not in `supabase_realtime` either: nothing subscribes to it.
alter table public.pet_intakes enable row level security;

/* ---- Who already answered the consent question ---- */

-- Publishing the photo publishes the way back to whoever sent it: their number,
-- or their username when the number is hidden behind one. That used to be
-- announced in the first message and taken as accepted by the last tap.
-- Announcing is not asking, so there is a fourth question with two buttons, and
-- no photo is published without a yes.
--
-- It is asked once. Whoever already said yes sends their second photo and
-- publishes it in three taps, the way it always worked — and this is the memory
-- that makes that possible, because `pet_intakes` cannot be: that one is deleted
-- on publish.
--
-- The key is the address the function already works with: the digits, or the
-- business-scoped user id of somebody writing from a username. Same value as
-- `pet_intakes.wa_from`, and read as a phone nowhere.
--
-- Kept in the clear rather than hashed on purpose: this is the record of a
-- consent, and a record nobody can read proves nothing. It lives behind the same
-- defences as `pet_intakes` — RLS on and not a single policy, so only
-- `service_role` sees it — and outside `supabase_realtime`.
--
-- Nothing sweeps it. An «already asked» with an expiry date is asking again the
-- person who already answered.
create table public.pet_senders (
  wa_from     text primary key,
  consented   boolean not null,
  -- When they said it. This is what gets shown if a published photo ever has to
  -- be answered for.
  decided_at  timestamptz not null default now()
);

alter table public.pet_senders enable row level security;

/* ================================================================== */
/* Las cifras de la emergencia                                         */
/* ================================================================== */

-- La primera tabla del proyecto cuyas filas son afirmaciones sobre el mundo y no
-- sobre sus propios usuarios: cuántos muertos, cuántas viviendas, cuánta gente.
-- Un número equivocado acá es desinformación en una página de emergencia, que no
-- es lo mismo que un pin equivocado, y de ahí sale todo lo demás — la fuente
-- única, el corte a la vista y la superficie de escritura más angosta del
-- proyecto.
--
-- **Una fila es un corte entero.** La UNGRD publica un balance nuevo casi cada
-- día —239 muertos el 12 de agosto, 273 el 13, 294 el 15— y a veces más de uno el
-- mismo día. Guardando el corte completo en `figures`, ninguna consulta puede
-- mezclar dos: la fila *es* el corte, y juntar el desglose de un día con el total
-- de otro sería inventar una consistencia que nadie publicó.
create table public.stats (
  id          text primary key check (id ~ '^[a-z0-9-]{3,60}$'),
  source      text not null check (char_length(source) between 2 and 60),
  source_url  text check (source_url is null or char_length(source_url) <= 300),
  -- El corte que estampó la fuente, no cuándo se escribió la fila. Es lo que se
  -- pinta debajo de los números y lo que los ordena.
  cut_at      timestamptz not null,
  -- Las llaves son ids del catálogo de `src/scripts/stats.ts`. Se valida que sea
  -- un objeto y nada más, igual que `centers.donations` se valida por largo y no
  -- por contenido: el catálogo vive en el repo y crece sin migración.
  --
  -- No hay columna que diga de qué tipo es el corte. Cada uno trae las llaves que
  -- publicó, y las que no, no están: el balance del 15 de agosto no trae desglose
  -- por departamento y el del 13 sí. Con eso alcanza para que la página muestre
  -- cada bloque con su propia fecha, sin una columna que los clasifique.
  figures     jsonb not null check (jsonb_typeof(figures) = 'object'),
  created_at  timestamptz not null default now()
);

create index stats_cut_idx on public.stats (cut_at desc);

alter table public.stats replica identity full;
alter table public.stats enable row level security;
alter publication supabase_realtime add table public.stats;

create policy "stats are public"
  on public.stats for select to anon, authenticated using (true);

-- Y no hay más: **ni insert, ni update, ni delete**. Más angosta todavía que
-- `centers`, que al menos deja registrar un acopio. Acá escribe solo
-- `service_role`, o sea un mantenedor en el editor de SQL, y por eso esta tabla
-- tampoco entra en el freno de inserciones de más abajo: no hay quién la golpee.

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
