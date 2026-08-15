-- The contact of a pet, when the phone is hidden.
--
-- WhatsApp lets a person put a username in front of their number. To the
-- business the phone then simply does not exist: the webhook carries no `from`
-- and no `wa_id`, only a business-scoped user id and the username. Meta puts the
-- phone back only for someone who wrote to us, or we to them, in the last 30
-- days — which whoever writes for the first time never is.
--
-- So `contact_phone` stops being the only contact and stops being mandatory. A
-- row carries the phone or the username, and the card opens `wa.me/<username>`
-- for the second, which resolves the chat the same as a number does.
--
-- Idempotent delta. The full snapshot is in `supabase/schema.sql`.

alter table public.pets add column if not exists contact_username text;

-- The alphabet WhatsApp allows a username, plus the length. Same kind of shape
-- check as the phone one: it stops the column being used as free text.
alter table public.pets drop constraint if exists pets_contact_username_check;
alter table public.pets add constraint pets_contact_username_check
  check (contact_username is null or contact_username ~ '^[A-Za-z0-9._-]{3,30}$');

-- The phone survives its own CHECK untouched: a NULL against a `~` yields NULL,
-- which a CHECK accepts. What goes is only the NOT NULL.
alter table public.pets alter column contact_phone drop not null;

-- One of the two, and the row is useless without either: a photo nobody can be
-- written about is a photo nobody can claim.
alter table public.pets drop constraint if exists pets_contact_check;
alter table public.pets add constraint pets_contact_check
  check (contact_phone is not null or contact_username is not null);

-- The waiting room remembers the username from the message that brought the
-- photo: what the row is published under should be what was true then.
alter table public.pet_intakes add column if not exists wa_username text;
