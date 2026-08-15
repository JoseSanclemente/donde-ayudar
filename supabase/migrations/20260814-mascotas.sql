-- Delta over `20260813-voluntarios-kind.sql`. `supabase/schema.sql` stays the
-- full snapshot a new project runs in one paste; this is the only thing to run
-- on the project already up. It can be run twice: every statement is guarded.
--
-- What changes: the first table with a file behind it. Someone finds a pet in
-- the street, publishes the photo they already took and a phone, and `/mascotas`
-- shows it. The photo goes to a public Storage bucket and the row keeps only its
-- object key — the bytes in a column would ride along in every realtime payload
-- and in every read of the table.

/* ================================================================== */
/* 1. The table                                                        */
/* ================================================================== */

create table if not exists public.pets (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users on delete cascade,
  kind          text not null,
  -- The object key inside the bucket, not a url. The pattern is a shape check,
  -- like the phone one: it stops the column being used as free text or as a full
  -- address to somewhere else.
  photo_path    text not null check (photo_path ~ '^[a-zA-Z0-9/_.-]{3,200}$'),
  -- The only contact, and mandatory: the phone is what the page is for. No name
  -- next to it — whoever writes is asking about the animal, not about a person.
  contact_phone text not null check (contact_phone ~ '^[0-9+][0-9 ()+-]{6,19}$'),
  created_at    timestamptz not null default now()
);

alter table public.pets drop constraint if exists pets_kind_check;
alter table public.pets add constraint pets_kind_check
  check (kind in ('dog', 'cat', 'other'));

create index if not exists pets_created_at_idx
  on public.pets (created_at desc);
create index if not exists pets_user_created_at_idx
  on public.pets (user_id, created_at desc);

alter table public.pets replica identity full;
alter table public.pets enable row level security;

/* ================================================================== */
/* 2. Realtime                                                         */
/* ================================================================== */

-- `alter publication ... add table` has no `if not exists`, and it errors when
-- the table is already published.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'pets'
  ) then
    alter publication supabase_realtime add table public.pets;
  end if;
end;
$$;

/* ================================================================== */
/* 3. Policies                                                         */
/* ================================================================== */

drop policy if exists "pets are public" on public.pets;
create policy "pets are public"
  on public.pets for select to anon, authenticated using (true);

drop policy if exists "anyone publishes a pet they found" on public.pets;
create policy "anyone publishes a pet they found"
  on public.pets for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "authors delete their own pet" on public.pets;
create policy "authors delete their own pet"
  on public.pets for delete to authenticated
  using ((select auth.uid()) = user_id);

-- No UPDATE policy, like everywhere else: the animal was returned or it was not.
-- A correction is deleting the row and publishing again with the right photo.

/* ================================================================== */
/* 4. Throttle                                                         */
/* ================================================================== */

drop trigger if exists pets_throttle on public.pets;
create trigger pets_throttle before insert on public.pets
  for each row execute function public.throttle_inserts(4);

/* ================================================================== */
/* 5. The bucket the photos live in                                    */
/* ================================================================== */

-- Public: the photos are meant to be seen by everyone, exactly like the rows, so
-- reading needs no policy and no signed url. The mime list and the 5 MB ceiling
-- are the server-side half of what the form also checks — a phone camera hands
-- out several megabytes without asking.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('pets', 'pets', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Writing does need policies, and they mirror the table's: anyone uploads in
-- their own name, only the owner removes. `owner` is set by Storage itself from
-- the session, so it is the same fact `user_id` carries in the row.
drop policy if exists "anyone uploads a pet photo" on storage.objects;
create policy "anyone uploads a pet photo"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'pets' and owner = (select auth.uid()));

drop policy if exists "authors delete their own pet photo" on storage.objects;
create policy "authors delete their own pet photo"
  on storage.objects for delete to authenticated
  using (bucket_id = 'pets' and owner = (select auth.uid()));
