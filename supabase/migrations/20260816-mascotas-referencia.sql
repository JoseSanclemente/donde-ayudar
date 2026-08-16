-- The code a pet already had somewhere else.
--
-- A batch published by `scripts/seed-pets.mjs` comes from an organization that
-- keeps its own register, and the whole batch shares one contact: whoever
-- receives «Escribir al WhatsApp» reads twenty messages about twenty animals and
-- has no way to tell which is which. This is the identifier they already work
-- with — `ROYI-00012` — travelling with the row so it comes back in the first
-- message, in the `?text=` of the button and in the link that opens the card.
--
-- Optional and written only from the seeder: a pet published from the form or
-- from the WhatsApp bot has no register behind it. A shape check and not a
-- foreign key, because there is no table of external systems; what the pattern
-- stops is the column becoming free text that ends up in a url.
--
-- Idempotent delta. The full snapshot is in `supabase/schema.sql`.

alter table public.pets add column if not exists ref_code text;

alter table public.pets drop constraint if exists pets_ref_code_check;
alter table public.pets add constraint pets_ref_code_check
  check (ref_code is null or ref_code ~ '^[A-Za-z0-9][A-Za-z0-9 _-]{2,39}$');
