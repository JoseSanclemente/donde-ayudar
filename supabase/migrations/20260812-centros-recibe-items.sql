-- Delta sobre `20260812-centros-comunidad.sql`. `supabase/schema.sql` sigue
-- siendo la foto completa que corre un proyecto nuevo de un solo pegado; esto es
-- lo único que hay que correr en el proyecto que ya está arriba.
--
-- Se puede correr dos veces sin romper nada: los constraints se sueltan antes de
-- ponerlos, y la expansión de datos filtra por ids de categoría, que después de
-- la primera corrida ya no quedan.
--
-- Qué cambia: `recibe` deja de guardar ids de categoría y pasa a guardar los
-- nombres de los insumos, los mismos de `reports.resources`. Un punto que solo
-- recibe pañales se publicaba como si recibiera toda la categoría «Insumos para
-- bebés», y el popup prometía leche en polvo y toallitas húmedas que ahí no
-- reciben. Lo que se pide y lo que se ofrece ahora se nombran igual.

/* ================================================================== */
/* 1. Los CHECK: la lista cerrada se va, el largo se queda             */
/* ================================================================== */

-- El catálogo estaba duplicado acá, y era el único lugar fuera del repo. Con los
-- nombres de insumo la lista cerrada sería el catálogo entero —sesenta y seis
-- textos escritos a mano— y cada edición de `resources.ts` pediría migración.
-- Se valida como `reports.resources`: por largo, no por contenido.
alter table public.centros drop constraint if exists centros_recibe_ids;

-- Un acopio puede recibirlo todo, y el catálogo tiene 66 ítems: veinte dejó de
-- ser un techo con el que alguien pueda vivir.
alter table public.centros drop constraint if exists centros_recibe_por_tipo;
alter table public.centros add constraint centros_recibe_por_tipo
  check (
    case when tipo = 'sangre' then cardinality(recibe) = 0
         else cardinality(recibe) between 1 and 80 end
  );

/* ================================================================== */
/* 2. Las filas que ya estaban: de id de categoría a nombres de insumo */
/* ================================================================== */

-- El único sitio donde el texto del catálogo queda escrito en SQL, y es historia
-- congelada: una migración de datos no vuelve a leer el repo. La lista de
-- «voluntarios» es la corta a propósito —el `itemsEnPunto` de `resources.ts`—,
-- que es justo lo que el popup ya mostraba: en un acopio no hay escombros que
-- remover ni sangre que donar. Así ningún punto curado cambia lo que dice.
with catalogo(cat_id, items) as (
  values
    ('herramientas', array[
      'Guantes de construcción','Gafas','Tapabocas N95','Cascos']),
    ('rescate', array[
      'Porras','Percutores','Discos de pulidora para varilla','Picas','Palas',
      'Cinceles','Seguetas','Baldes','Cintas de seguridad','Costales']),
    ('logistica', array[
      'Plantas eléctricas','Extensiones','Linternas','Pilas AA','Hielo',
      'Neveras de icopor','Megáfonos','Baños portátiles','Colchonetas','Cobijas']),
    ('bebes', array[
      'Pañales','Leche en polvo','Suplementos nutricionales (Ensure)',
      'Toallitas húmedas','Cremas para pañalitis']),
    ('alimentos', array[
      'Enlatados','Granos','Arroz','Aceite','Agua','Jugos',
      'Alimento para mascotas']),
    ('salud', array[
      'Gasas','Alcohol','Jabón de cuerpo','Papel higiénico','Crema dental',
      'Cepillo de dientes','Esparadrapo','Solución salina','Catéter #18 o #24',
      'Ampollas de dipirona','Equipo de macrogoteo','Acetaminofén','Diclofenaco',
      'Meloxicam','Piroxicam','Agua oxigenada','Caja de guantes de látex',
      'Tijeras','Isodine','Micropore','Balas de oxígeno','Cánulas',
      'Catéteres 14G y 20G','Dextrosa al 5% y al 10%']),
    ('voluntarios', array[
      'Transporte de insumos','Ayuda para organizar donaciones'])
),
expandido as (
  select c.id,
         array_agg(distinct v.item) as recibe
    from public.centros c
    cross join lateral (
      -- Lo que no es id de categoría pasa tal cual: la tabla ya puede traer
      -- nombres de insumo de un punto registrado después del deploy.
      select unnest(coalesce(cat.items, array[valor])) as item
        from unnest(c.recibe) as valor
        left join catalogo cat on cat.cat_id = valor
    ) v
   where c.recibe && array[
     'herramientas','rescate','logistica','bebes','alimentos','salud','voluntarios'
   ]::text[]
   group by c.id
)
update public.centros c
   set recibe = e.recibe
  from expandido e
 where e.id = c.id;

/* ================================================================== */
/* 3. El tope de largo, ahora que el contenido es texto libre          */
/* ================================================================== */

-- Va después de expandir: sin la lista cerrada, este es el único freno que queda
-- entre un insert y megabytes de texto que todos los visitantes se descargan al
-- abrir el mapa. Mismo tope de `reports.resources`.
alter table public.centros drop constraint if exists centros_recibe_largo;
alter table public.centros add constraint centros_recibe_largo
  check (public.max_text_len(recibe) <= 60);
