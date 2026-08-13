-- Delta over `20260813-centers-english.sql`. `supabase/schema.sql` stays the
-- full snapshot a new project runs in one paste; this is the only thing to run
-- on the project already up. It can be run twice: the column is guarded with
-- `if not exists` and the function goes through `create or replace`.
--
-- What changes: an offer can be called done. Until now it had two ends only —
-- it sat in the list forever, or its author deleted it — and the author is an
-- anonymous session that dies with the browser storage, so nobody ever retires
-- anything. The backhoe that worked one afternoon kept being counted as
-- available capacity. `finished_at` records when the help was delivered, and
-- `set_offer_finished` lets anyone say so, the same way anyone confirms a
-- collection point is still open.

/* ================================================================== */
/* 1. When the offer was called done                                   */
/* ================================================================== */

alter table public.offers
  add column if not exists finished_at timestamptz;

/* ================================================================== */
/* 2. Calling an offer done                                            */
/* ================================================================== */

-- Communal for the same reason assigning it is: the backhoe already worked,
-- whoever published it is not watching the site, and their anonymous session
-- died with the browser storage.
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

-- Supabase grants EXECUTE to anon and authenticated when the function is
-- created, so `revoke from public` is not enough: anon has to be named.
revoke all     on function public.set_offer_finished(uuid, boolean) from public;
revoke execute on function public.set_offer_finished(uuid, boolean) from anon;
grant  execute on function public.set_offer_finished(uuid, boolean) to authenticated;
