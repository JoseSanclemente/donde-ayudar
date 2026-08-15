-- Delta over `20260813-centers-english.sql`. `supabase/schema.sql` is still the
-- full snapshot a fresh project runs in one paste; this is the only thing to run
-- on the project already up.
--
-- It can be run twice without breaking anything: the constraint is dropped
-- before it is added.
--
-- What changes: a fifth `type`, `municipio` — a whole municipality asking for
-- help, published by a maintainer after reading the news. Its coordinate is the
-- cabecera and not an address, so `address` carries the municipality and the
-- department, and `hours` stays empty: a town has no opening hours.
--
-- Nothing else moves. The insert policy already pins `type = 'acopio'`, so the
-- browser cannot create one — the same wall that already protects `albergue`,
-- `sangre` and `healthcare`. `confirm_center` already refuses anything that is
-- not a community `acopio`, so no visitor can extend a municipality's life
-- either, which is the whole point: what ages here is the reporting the row was
-- read out of, and only somebody redoing that sweep can answer for it.
--
-- The expiry is read in the browser off `updated_at`, like every other one in
-- this project — `MUNICIPIO_DAYS` in `src/scripts/centers.ts`, 30 days. Past it
-- the point comes off the map instead of going grey: a grey square says «this
-- place exists, do not walk over there yet», and here what aged is the claim
-- itself. Reviving one is `update … set updated_at = now()`; retiring it is
-- `delete`. Both are in `supabase/README.md`.

alter table public.centers drop constraint if exists centers_type_check;

alter table public.centers
  add constraint centers_type_check
  check (type in ('acopio','albergue','sangre','healthcare','municipio'));
