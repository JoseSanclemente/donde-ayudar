-- Where a found pet is right now.
--
-- The page started as people who picked up an animal in the street, and for them
-- there is nothing to say: whoever writes goes to whoever answers. What the grid
-- is being filled with now are pets held by organizations, vets and collection
-- points, and there the name of the place is the fact that is missing — a dog at
-- a known vet is a dog somebody can walk to.
--
-- Optional, like in `reports`: a pet somebody has at home has no place, and the
-- card simply does not paint the line. Nothing in the browser writes it — no form
-- field, no step in the WhatsApp bot, nothing in the seeder — it is maintainer
-- SQL. Same shape and same ceiling as `reports.place_name`.
--
-- Idempotent delta. The full snapshot is in `supabase/schema.sql`.

alter table public.pets add column if not exists place_name text;

alter table public.pets drop constraint if exists pets_place_name_check;
alter table public.pets add constraint pets_place_name_check
  check (place_name is null or char_length(place_name) between 1 and 120);
