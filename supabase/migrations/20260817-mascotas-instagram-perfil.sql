-- Delta over `20260814-mascotas.sql`. `supabase/schema.sql` stays the full
-- snapshot a new project runs in one paste; this is the only thing to run on the
-- project already up. It can be run twice: the constraint is dropped first.
--
-- What changes: `pets.contact_instagram_url` took a post permalink and nothing
-- else, which is right for a pet that came off one publication. A batch handed
-- over by an institution has no post per animal — the account is the whole
-- address there — so the column now also takes the profile.

alter table public.pets drop constraint if exists pets_contact_instagram_url_check;
alter table public.pets add constraint pets_contact_instagram_url_check
  check (contact_instagram_url is null or contact_instagram_url ~
    '^https://(www\.)?instagram\.com/((p|reel)/[A-Za-z0-9_-]{5,30}|[A-Za-z0-9._]{1,30})/?$');
