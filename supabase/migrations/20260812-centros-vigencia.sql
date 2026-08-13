-- Delta sobre `20260812-centros-comunidad.sql`. `supabase/schema.sql` sigue
-- siendo la foto completa que corre un proyecto nuevo de un solo pegado; esto es
-- lo único que hay que correr en el proyecto que ya está arriba.
--
-- Se puede correr dos veces sin romper nada: todo va con `if not exists` o con
-- `create or replace`.
--
-- Qué cambia: un punto de acopio registrado por la comunidad vence —solo ese:
-- un albergue no, ahí duerme gente, y un punto curado tampoco—. Nadie lo
-- retira nunca —no hay policy de UPDATE y el autor pierde su sesión al limpiar
-- el navegador—, así que el colegio que recogió donaciones una tarde se queda en
-- el mapa como punto vivo para siempre. Con `confirmed_at`, el tiempo que fija
-- `EXPIRY_HOURS` —en `src/scripts/centros.ts`— sin que nadie lo confirme lo
-- pinta gris; un toque en «Sigue abierto» lo revive.

/* ================================================================== */
/* 1. Cuándo fue la última vez que alguien confirmó el punto           */
/* ================================================================== */

alter table public.centros
  add column if not exists confirmed_at timestamptz not null default now();

-- The default stamps every existing row with the moment the migration ran,
-- which would quietly vouch for points nobody has looked at in weeks. The
-- creation date is the last thing anybody actually stated about them, so the
-- ones already past the threshold land expired — that is the correct reading of
-- the data, not a regression. Only the community ones: a curated point never
-- expires and its `confirmed_at` is never read.
update public.centros
   set confirmed_at = created_at
 where origen = 'comunidad'
   and confirmed_at > created_at;

/* ================================================================== */
/* 2. Confirmar que un punto sigue abierto                             */
/* ================================================================== */

-- Anyone can say a community point is still open, the same way anyone can mark
-- a resource covered: whoever walks past knows, and the author cannot be the
-- one to answer — their session is anonymous and dies with the browser storage,
-- which would strand the point as expired forever.
--
-- It refuses to touch `recibiendo`: a maintainer who paused a point paused it
-- for a reason, and confirming that the place exists is not the same claim as
-- confirming it is taking donations again.
create or replace function public.confirm_centro(p_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_id is null or char_length(p_id) > 60 then
    raise exception 'punto inválido' using errcode = '22023';
  end if;

  update public.centros c
     set confirmed_at = now()
   where c.id = p_id
     -- Lo mismo que vence en el navegador, y nada más: un punto curado no vence
     -- así que tampoco se confirma, un albergue comunitario tampoco —ahí duerme
     -- gente— y uno cerrado (`activo = false`) no vuelve por esta vía.
     and c.tipo = 'acopio'
     and c.origen = 'comunidad'
     and c.activo;
end;
$$;

-- Supabase le concede EXECUTE a anon y authenticated al crear la función, así
-- que `revoke from public` no alcanza: hay que quitárselo a `anon` por nombre.
revoke all     on function public.confirm_centro(text) from public;
revoke execute on function public.confirm_centro(text) from anon;
grant  execute on function public.confirm_centro(text) to authenticated;
