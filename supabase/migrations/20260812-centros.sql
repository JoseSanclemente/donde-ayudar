-- Delta sobre el esquema anterior. `supabase/schema.sql` sigue siendo la foto
-- completa que corre un proyecto nuevo de un solo pegado; esto es lo único que
-- hay que correr en el proyecto que ya está arriba.
--
-- Se puede correr dos veces sin romper nada: todo va con `if not exists`, con
-- `create or replace` o dentro de un bloque que atrapa el duplicado.
--
-- Qué cambia: los puntos de donación dejan de ser archivos YAML del repo y
-- pasan a esta tabla. Antes, corregir el horario de un albergue era un commit y
-- un deploy de Netlify; ahora es una fila en el editor de tablas.

/* ================================================================== */
/* 1. Puntos de donación — curados, de lectura pública                 */
/* ================================================================== */

create table if not exists public.centros (
  -- Slug, not uuid: it is the old YAML filename, it survives the migration,
  -- and a maintainer scanning the table editor can tell the rows apart.
  id          text primary key check (id ~ '^[a-z0-9-]{3,60}$'),
  tipo        text not null check (tipo in ('acopio','albergue','sangre')),
  name        text not null check (char_length(name) between 3 and 120),
  direccion   text not null check (char_length(direccion) between 3 and 200),
  -- Mismo bounding box de Cali que los reportes.
  lat         double precision not null check (lat between 3.2 and 3.6),
  lng         double precision not null check (lng between -76.75 and -76.3),
  -- Empty string is a real value here: a point whose opening hours nobody has
  -- confirmed yet. The popup just leaves the line blank.
  horario     text not null default '' check (char_length(horario) <= 120),
  telefono    text check (telefono is null or char_length(telefono) <= 40),
  notas       text check (notas is null or char_length(notas) <= 300),
  recibe      text[] not null default '{}',
  -- `false` = still open, not taking supplies right now (warehouse full). It
  -- stays on the map in grey; closing for real is `activo = false`.
  recibiendo  boolean not null default true,
  nota_estado text check (nota_estado is null or char_length(nota_estado) <= 200),
  activo      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- The discriminated union src/content.config.ts used to enforce: a blood bank
-- takes no supplies and must not list any, everything else must list one.
do $$ begin
  alter table public.centros add constraint centros_recibe_por_tipo
    check (
      case when tipo = 'sangre' then cardinality(recibe) = 0
           else cardinality(recibe) between 1 and 20 end
    );
exception when duplicate_object then null; end $$;

-- Unlike `offers.category`, this one is a closed list: a typo here silently
-- drops a chip from the popup, and nobody rereads a row they already saved.
-- Keep it in sync with CATEGORIES in src/scripts/resources.ts.
do $$ begin
  alter table public.centros add constraint centros_recibe_ids
    check (
      recibe <@ array[
        'herramientas','rescate','logistica','bebes','alimentos','salud','voluntarios'
      ]::text[]
    );
exception when duplicate_object then null; end $$;

-- The client only ever asks for the active ones.
create index if not exists centros_activo_idx on public.centros (activo);

alter table public.centros replica identity full;
alter table public.centros enable row level security;

do $$ begin
  alter publication supabase_realtime add table public.centros;
exception when duplicate_object then null; end $$;

-- The only policy. With no insert/update/delete policy RLS denies all three to
-- anon and authenticated, which is the whole point: repo and dashboard access
-- stay the only way to publish a point.
drop policy if exists "puntos visibles para todos" on public.centros;
create policy "puntos visibles para todos"
  on public.centros for select to anon, authenticated using (true);

-- `updated_at` is the maintainer's own trail — which point was touched last
-- time the city changed. The other tables have no UPDATE path, so this trigger
-- has no equivalent to reuse.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function public.touch_updated_at() from public;

drop trigger if exists centros_touch_updated_at on public.centros;
create trigger centros_touch_updated_at before update on public.centros
  for each row execute function public.touch_updated_at();

/* ================================================================== */
/* 2. Los once puntos que venían de src/content/centros/*.yaml         */
/* ================================================================== */

-- `do nothing` y no `do update`: si esta migración se vuelve a correr sobre un
-- proyecto donde ya se corrigió un horario a mano, la corrección manda.
insert into public.centros (id, tipo, name, direccion, lat, lng, horario, recibe) values
  ('ciudadela-petronio-alvarez', 'acopio',
   'Ciudadela Petronio Álvarez',
   'Complejo deportivo Alberto Galindo, Cali, Valle',
   3.4127351272525983, -76.55095332379257, '',
   array['logistica','bebes','herramientas','voluntarios']),

  ('escuela-nacional-del-deporte', 'acopio',
   'Escuela Nacional del Deporte',
   'Cll 9 # 34 - 01, Eucarístico, Cali, Valle',
   3.426460467304358, -76.53700594023968, '',
   array['logistica','bebes','herramientas','voluntarios']),

  ('parque-de-la-cana', 'acopio',
   'Parque de la Caña',
   'Cra. 8 # 39 - 01, Cali, Valle',
   3.454602754860729, -76.50732444002169, '',
   array['logistica','herramientas','voluntarios']),

  ('plazoleta-jairo-varela', 'acopio',
   'Plazoleta Jairo Varela',
   'Av. 2 Nte # 10 Nte - 1, Granada, Cali, Valle',
   3.455082069123727, -76.53482963586626, '',
   array['logistica','herramientas','voluntarios']),

  ('albergue-coliseo-metropolitano-norte', 'albergue',
   'Coliseo Metropolitano del Norte',
   'Cra. 1a 12 #69-26, Cali, Valle',
   3.480736563747716, -76.49051058856566, '',
   array['salud','logistica','voluntarios']),

  ('albergue-hockey-miguel-calero', 'albergue',
   'Coliseo de Hockey en Línea Miguel Calero',
   'Calle 9 con carrera 37A/39, Cali, Valle',
   3.4222596197664648, -76.53807753078131, '',
   array['salud','logistica','voluntarios']),

  ('banco-sangre-cruz-roja', 'sangre',
   'Banco de sangre Cruz Roja',
   'Parqueadero Cruz Roja Valle, Cra. 38 Bis #5B, San Fernando',
   3.4274096316055784, -76.54509998845228, '8:00 a. m. – 6:00 p. m.',
   '{}'),

  ('banco-sangre-hemolife', 'sangre',
   'Banco de sangre Hemolife',
   'Punto fijo: Cll 38N #3N - 61, Prados del Norte',
   3.474807599359296, -76.52041744335258, '8:00 a. m. – 6:00 p. m.',
   '{}'),

  ('banco-sangre-huv', 'sangre',
   'Banco de sangre HUV',
   'Cll 5ta #36 - 08, Urgencias del Hospital Universitario del Valle',
   3.431210586126767, -76.54445585134974, '8:00 a. m. – 6:00 p. m.',
   '{}'),

  ('banco-sangre-imbanaco', 'sangre',
   'Banco de sangre Imbanaco',
   'Sede principal, Cra. 38 Bis #5B2 - 04, Santa Isabel',
   3.4267575475725165, -76.54542339030029, '8:00 a. m. – 6:00 p. m.',
   '{}'),

  ('banco-sangre-valle-del-lili', 'sangre',
   'Banco de sangre Fundación Valle del Lili',
   'Sede principal, Torre 2 piso 4',
   3.3729828323930713, -76.52560814612303, '8:00 a. m. – 6:00 p. m.',
   '{}')
on conflict (id) do nothing;
