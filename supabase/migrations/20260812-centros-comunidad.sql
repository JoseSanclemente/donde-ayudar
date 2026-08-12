-- Delta sobre `20260812-centros.sql`. `supabase/schema.sql` sigue siendo la foto
-- completa que corre un proyecto nuevo de un solo pegado; esto es lo único que
-- hay que correr en el proyecto que ya está arriba.
--
-- Se puede correr dos veces sin romper nada: todo va con `if not exists`, con
-- `drop ... if exists` antes de crear, o dentro de un bloque que atrapa el
-- duplicado.
--
-- Qué cambia:
--   1. `centros` deja de ser solo curada. Cualquiera puede registrar un punto de
--      acopio desde el formulario; queda marcado como comunitario y se ve al
--      instante en el mapa.
--   2. La caja de coordenadas deja de ser Cali y pasa a ser Colombia, en
--      `centros` y en `reports`: la ayuda se empezó a coordinar con otros
--      municipios y la caja vieja los rechazaba en la base de datos.

/* ================================================================== */
/* 1. Colombia, no Cali                                                */
/* ================================================================== */

-- Los CHECK viejos eran de columna y sin nombre, así que Postgres los llamó
-- `<tabla>_<columna>_check`. Se sueltan y se vuelven a poner con la caja nueva.
alter table public.reports drop constraint if exists reports_lat_check;
alter table public.reports drop constraint if exists reports_lng_check;
alter table public.reports add constraint reports_lat_check check (lat between -4.3 and 13.5);
alter table public.reports add constraint reports_lng_check check (lng between -82.0 and -66.8);

alter table public.centros drop constraint if exists centros_lat_check;
alter table public.centros drop constraint if exists centros_lng_check;
alter table public.centros add constraint centros_lat_check check (lat between -4.3 and 13.5);
alter table public.centros add constraint centros_lng_check check (lng between -82.0 and -66.8);

/* ================================================================== */
/* 2. Puntos de acopio registrados por la comunidad                    */
/* ================================================================== */

-- `default 'curado'` marca de una vez las once filas que ya estaban: todas
-- vienen del editor de tablas.
alter table public.centros
  add column if not exists origen text not null default 'curado';

alter table public.centros
  add column if not exists user_id uuid references auth.users on delete cascade;

do $$ begin
  alter table public.centros add constraint centros_origen_check
    check (origen in ('curado','comunidad'));
exception when duplicate_object then null; end $$;

-- Un punto curado no tiene autor; uno comunitario tiene exactamente uno. Sin
-- esto, un `user_id` nulo en una fila comunitaria la volvería imborrable.
do $$ begin
  alter table public.centros add constraint centros_origen_autor
    check (
      (origen = 'curado'    and user_id is null) or
      (origen = 'comunidad' and user_id is not null)
    );
exception when duplicate_object then null; end $$;

-- El freno de inserciones cuenta por autor y por minuto.
create index if not exists centros_user_created_idx
  on public.centros (user_id, created_at desc);

-- Toda la superficie de escritura de la tabla, y es a propósito así de estrecha:
-- solo un acopio, solo `origen = 'comunidad'`, solo a nombre de quien inserta.
-- Un punto curado no se puede crear desde el navegador ni por accidente ni a
-- propósito — el editor de tablas sigue siendo la única vía.
drop policy if exists "la comunidad registra acopios" on public.centros;
create policy "la comunidad registra acopios"
  on public.centros for insert to authenticated
  with check (
    origen = 'comunidad'
    and tipo = 'acopio'
    and activo
    and (select auth.uid()) = user_id
  );

-- Espejo de `reports`: cada quien borra lo suyo, y lo curado no lo borra nadie.
drop policy if exists "cada quien borra su punto" on public.centros;
create policy "cada quien borra su punto"
  on public.centros for delete to authenticated
  using (origen = 'comunidad' and (select auth.uid()) = user_id);

-- Sigue sin haber policy de UPDATE. Corregir un punto ajeno —o el propio— es
-- una edición completa de la fila: nombre, coordenadas y horario a la vez. Las
-- otras tablas resuelven lo comunitario con RPC de una sola columna; acá no hay
-- ninguna columna comunitaria que valga abrir.

-- El más bajo de los cuatro frenos: un punto de acopio es una respuesta, no un
-- reporte, y nadie abre tres bodegas en un minuto. Cuenta por `user_id`, así que
-- las filas curadas —sin autor— nunca entran en la cuenta.
drop trigger if exists centros_throttle on public.centros;
create trigger centros_throttle before insert on public.centros
  for each row execute function public.throttle_inserts(3);
