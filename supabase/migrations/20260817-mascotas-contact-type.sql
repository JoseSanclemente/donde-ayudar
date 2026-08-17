-- Delta over `20260817-mascotas-instagram-perfil.sql`. `supabase/schema.sql`
-- stays the full snapshot a new project runs in one paste; this is the only
-- thing to run on the project already up. It can be run twice: every statement
-- is guarded.
--
-- What changes: which app a pet's button opens is now readable, and only that.
-- The three contact columns were revoked from the browser — two hundred rows
-- were two hundred phone numbers in one response — so a card paints its button
-- before knowing where it leads and guessed WhatsApp, then swapped the label
-- when the contact arrived on hover. `contact_type` says which of the four the
-- row carries and no identifier: enough to paint the right label, icon and
-- colour from the first render.

alter table public.pets
  add column if not exists contact_type text
  generated always as (
    case
      when contact_phone is not null then 'phone'
      when contact_username is not null then 'username'
      when contact_instagram_url ~ '/(p|reel)/' then 'instagram_post'
      else 'instagram_profile'
    end
  ) stored;

grant select (contact_type) on public.pets to anon, authenticated;
