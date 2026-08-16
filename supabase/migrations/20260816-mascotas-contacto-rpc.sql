-- El contacto de una mascota, de a uno.
--
-- Primera mitad de un cambio partido en dos, y el orden entre ellas importa:
-- esta solo agrega una función y no le quita nada a nadie, así que el sitio que
-- está publicado en este momento sigue funcionando igual. La otra mitad
-- —`20260816-mascotas-contacto-privilegios.sql`— es la que quita el SELECT de
-- las columnas del contacto, y esa rompe cualquier bundle viejo que todavía las
-- pida. Va después de que el nuevo esté arriba.
--
-- El porqué está en la otra: acá solo está la puerta que el nuevo bundle usa.

-- `security definer` porque el rol que la llama va a quedarse, en la otra mitad,
-- sin privilegio para leer esas tres columnas.
--
-- Sin filtro de fila: la policy de SELECT de `pets` es `using (true)` y esto
-- devuelve el contacto de una mascota publicada, que es pública. Lo que cambia
-- es el precio de juntarlas todas.
create or replace function public.pet_contact(p_id uuid)
returns table (
  contact_phone text,
  contact_username text,
  contact_instagram_url text
)
language sql
stable
security definer
set search_path = public
as $$
  select p.contact_phone, p.contact_username, p.contact_instagram_url
  from public.pets p
  where p.id = p_id;
$$;

-- Igual que el resto de las funciones del esquema: `public` incluye a quien no
-- debería, y acá sí la llama el anónimo — `/mascotas` no abre sesión.
revoke all     on function public.pet_contact(uuid) from public;
grant  execute on function public.pet_contact(uuid) to anon, authenticated;
