-- Delta over `20260814-mascotas.sql`. `supabase/schema.sql` stays the full
-- snapshot a new project runs in one paste; this is the only thing to run on the
-- project already up. It can be run twice: every statement is guarded.
--
-- What changes: `pets` gets a second writer. Until now a row only existed if a
-- maintainer wrote it by hand; from here the `whatsapp-pets` Edge Function
-- publishes what people send to the WhatsApp number. That takes two things — a
-- waiting room for the photo between «here is a dog» and «it is a dog», and an
-- exemption from the insert throttle, which counts per author and would stop the
-- function at its fifth pet of the minute because every one of its rows carries
-- the same author.

/* ================================================================== */
/* 1. The waiting room                                                 */
/* ================================================================== */

-- A photo arrives before anyone has said what animal it is, so the function
-- answers with three buttons and waits. What it keeps in the meantime is not the
-- photo but the Graph media id: the bytes are downloaded only after the tap, so
-- a photo nobody classifies never reaches the bucket and there are no orphan
-- objects to sweep — only rows, and those go by themselves below.
create table if not exists public.pet_intakes (
  id            uuid primary key default gen_random_uuid(),
  -- The dedupe. Meta resends a webhook it believes failed, and the second copy
  -- of the same message must not open a second conversation.
  wa_message_id text not null unique,
  -- Who sent it, in the digits Meta uses: no `+`, no spaces. It becomes
  -- `contact_phone` on the published row.
  wa_from       text not null,
  media_id      text not null,
  mime_type     text not null,
  created_at    timestamptz not null default now()
);

create index if not exists pet_intakes_created_at_idx
  on public.pet_intakes (created_at desc);

-- RLS on and **not a single policy**: that is what makes the table invisible.
-- `anon` and `authenticated` get nothing — no select, no insert — and only
-- `service_role`, which skips RLS, can see a phone number that has not agreed to
-- being published yet. It is not in `supabase_realtime` either: nothing
-- subscribes, and `replica identity full` would only widen the WAL.
alter table public.pet_intakes enable row level security;

/* ================================================================== */
/* 2. The throttle, and who it is for                                  */
/* ================================================================== */

-- The throttle guards against a browser flooding a table. The Edge Function is
-- not a browser: it holds the `service_role` key, so it could bypass RLS
-- entirely, and rate-limiting it here would only be theatre — what it actually
-- does is break the feature, because every pet it publishes carries the same
-- bot author and the fifth one in a minute would be rejected.
--
-- A maintainer running SQL in the dashboard was never counted: with no session
-- `new.user_id` is null and the count below matches nothing.
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
  -- Read from the request claims and not from `current_user`: this function is
  -- `security definer`, so `current_user` is its owner and says nothing about
  -- who called.
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

revoke all     on function public.throttle_inserts() from public;
revoke execute on function public.throttle_inserts() from anon;
revoke execute on function public.throttle_inserts() from authenticated;
