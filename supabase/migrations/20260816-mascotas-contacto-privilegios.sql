-- El contacto de una mascota sale de la lectura de la tabla.
--
-- `pets` se lee entera desde el navegador —doscientas filas, una sola petición—
-- y hasta acá cada una traía su teléfono. La página nunca lo pintó: el botón
-- dice «Escribir al WhatsApp» y el número vive en el `href`. Pero la respuesta
-- del REST sí lo traía, así que doscientos números viajaban juntos a quien
-- pidiera la tabla, y eso es una lista, no un contacto.
--
-- El arreglo es de privilegios y no de RLS: RLS filtra filas, y lo que sobra acá
-- son columnas. Se quita el SELECT de tabla y se devuelve columna por columna,
-- sin las tres del contacto. Quien las quiera pide `pet_contact(id)`, que la
-- creó la otra mitad de este cambio.
--
-- La policy de SELECT no se toca: sigue siendo `using (true)`. Un privilegio
-- ausente y una fila filtrada son dos cosas distintas y las dos hacen falta.
--
-- **Va después de publicar el sitio nuevo.** Un bundle que todavía pida
-- `select("*")` recibe un error de permisos y `/mascotas` se queda en su estado
-- de error. `20260816-mascotas-contacto-rpc.sql` va antes, y no rompe nada.
--
-- Deshacer es un grant:
--   grant select on public.pets to anon, authenticated;

revoke select on public.pets from anon, authenticated;

grant select (
  id,
  user_id,
  kind,
  sex,
  photo_path,
  place_name,
  ref_code,
  created_at
) on public.pets to anon, authenticated;
