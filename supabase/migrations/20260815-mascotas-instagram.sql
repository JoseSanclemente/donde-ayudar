-- The contact of a pet that came from Instagram.
--
-- A batch of found pets collected off Instagram carries no phone and no
-- WhatsApp handle: what identifies each one is the post it was published in.
-- Neither existing contact column can hold it — both patterns forbid `:` and
-- `/` — and `contact_username` is drawn as `wa.me/<handle>`, so a value there
-- would build a button to a chat that does not exist.
--
-- The column is `contact_instagram_url` and not `contact_instagram` on purpose:
-- `centers` and `volunteers` store a bare handle under that name and their
-- helpers build a profile link out of it. This one is a permalink to a single
-- post, which is a different thing and links somewhere else.
--
-- Idempotent delta. The full snapshot is in `supabase/schema.sql`.

alter table public.pets add column if not exists contact_instagram_url text;

-- Anchored on `https://` and on the two shapes a post is published under. Same
-- kind of shape check as the phone and the username: it stops the column being
-- used as free text, and it is what keeps anything else from ever reaching an
-- `href` on the page.
alter table public.pets drop constraint if exists pets_contact_instagram_url_check;
alter table public.pets add constraint pets_contact_instagram_url_check
  check (contact_instagram_url is null or
         contact_instagram_url ~ '^https://(www\.)?instagram\.com/(p|reel)/[A-Za-z0-9_-]{5,30}/?$');

-- One of the three now. The row is still worthless without any of them: a photo
-- nobody can be written about is a photo nobody can claim.
alter table public.pets drop constraint if exists pets_contact_check;
alter table public.pets add constraint pets_contact_check
  check (contact_phone is not null
      or contact_username is not null
      or contact_instagram_url is not null);
