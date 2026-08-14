-- Delta over `20260813-offers-finished.sql`. `supabase/schema.sql` stays the
-- full snapshot a new project runs in one paste; this is the only thing to run
-- on the project already up. It can be run twice: every statement is guarded.
--
-- What changes: the «Salud mental» tab gets a table of its own. Anyone can sign
-- up as available to accompany the community, and the list of everyone who did
-- is public. It is `offers` in shape — anyone inserts, everyone reads, only the
-- author withdraws, no UPDATE policy — with one difference: the contact can be
-- a WhatsApp number or an Instagram handle, and one of the two is enough.
-- Whoever offers to listen does not always want to hand out their number.

/* ================================================================== */
/* 1. The table                                                        */
/* ================================================================== */

create table if not exists public.mental_health_volunteers (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null default auth.uid() references auth.users on delete cascade,
  name              text not null check (char_length(name) between 2 and 60),
  contact_phone     text check (contact_phone is null or contact_phone ~ '^[0-9+][0-9 ()+-]{6,19}$'),
  contact_instagram text check (contact_instagram is null or contact_instagram ~ '^[A-Za-z0-9._]{1,30}$'),
  notes             text check (notes is null or char_length(notes) <= 200),
  created_at        timestamptz not null default now(),
  -- Whoever signs up has to be reachable: a name with no way to answer it is
  -- not a volunteer, it is a line of text.
  constraint mental_health_volunteers_contact_check
    check (contact_phone is not null or contact_instagram is not null)
);

create index if not exists mental_health_volunteers_created_at_idx
  on public.mental_health_volunteers (created_at desc);
create index if not exists mental_health_volunteers_user_created_idx
  on public.mental_health_volunteers (user_id, created_at desc);

alter table public.mental_health_volunteers replica identity full;
alter table public.mental_health_volunteers enable row level security;

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
       and tablename = 'mental_health_volunteers'
  ) then
    alter publication supabase_realtime add table public.mental_health_volunteers;
  end if;
end;
$$;

/* ================================================================== */
/* 3. Policies                                                         */
/* ================================================================== */

drop policy if exists "inscripciones visibles para todas" on public.mental_health_volunteers;
create policy "inscripciones visibles para todas"
  on public.mental_health_volunteers for select to anon, authenticated using (true);

drop policy if exists "cada quien se inscribe a sí misma" on public.mental_health_volunteers;
create policy "cada quien se inscribe a sí misma"
  on public.mental_health_volunteers for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "cada quien retira su inscripción" on public.mental_health_volunteers;
create policy "cada quien retira su inscripción"
  on public.mental_health_volunteers for delete to authenticated
  using ((select auth.uid()) = user_id);

-- No UPDATE policy and no RPC: a signup either stands or is withdrawn, and
-- there is nothing communal to touch on someone else's card.

/* ================================================================== */
/* 4. Throttle                                                         */
/* ================================================================== */

drop trigger if exists mental_health_volunteers_throttle on public.mental_health_volunteers;
create trigger mental_health_volunteers_throttle
  before insert on public.mental_health_volunteers
  for each row execute function public.throttle_inserts(4);
