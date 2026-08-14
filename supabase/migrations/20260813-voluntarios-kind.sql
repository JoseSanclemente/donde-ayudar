-- Delta over `20260813-salud-mental.sql`. `supabase/schema.sql` stays the full
-- snapshot a new project runs in one paste; this is the only thing to run on the
-- project already up. It can be run twice: every statement is guarded.
--
-- What changes: «Salud mental» stops being a table of its own. The same shape —
-- a name, a WhatsApp or an Instagram, a note — now serves every panel where
-- someone offers their own time, and «Asesoría Jurídica» is the second. The
-- table is renamed to `volunteers` and a `kind` tells them apart, so a third
-- panel is a value in the CHECK and nothing else: one set of policies, one
-- throttle, one realtime publication.
--
-- Run it together with publishing the site: the bundle already deployed asks for
-- `mental_health_volunteers`, and between the two only that panel breaks.

/* ================================================================== */
/* 1. The rename                                                       */
/* ================================================================== */

-- Policies, indexes, the throttle trigger, `replica identity full` and the
-- membership in `supabase_realtime` all follow the table: none is reapplied.
do $$
begin
  if exists (
    select 1 from pg_tables
     where schemaname = 'public' and tablename = 'mental_health_volunteers'
  ) and not exists (
    select 1 from pg_tables
     where schemaname = 'public' and tablename = 'volunteers'
  ) then
    alter table public.mental_health_volunteers rename to volunteers;
  end if;
end;
$$;

/* ================================================================== */
/* 2. The discriminator                                                */
/* ================================================================== */

-- The default is what every row saved so far is: everything written until now
-- was signing up to accompany someone.
alter table public.volunteers
  add column if not exists kind text not null default 'salud_mental';

alter table public.volunteers drop constraint if exists volunteers_kind_check;
alter table public.volunteers add constraint volunteers_kind_check
  check (kind in ('salud_mental', 'juridica'));

-- Each panel reads its own kind, newest first.
create index if not exists volunteers_kind_created_at_idx
  on public.volunteers (kind, created_at desc);

-- `kind` needs no policy: the insert policy already pins the author, and the
-- CHECK is the whole of what a browser may write into this column.
