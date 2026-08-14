# Base de datos

Dos archivos, una sola verdad:

- **`schema.sql`** — la foto completa. Se corre tal cual, de un solo pegado, en
  el SQL Editor de un proyecto **nuevo**.
- **`migrations/`** — el delta. Es lo que se corre en el proyecto que **ya está
  arriba**. Cada archivo es idempotente: correrlo dos veces no rompe nada.

Cuando cambies el esquema, actualiza los dos: el delta para producción y la foto
para que un proyecto nuevo siga arrancando de una sola corrida.

Fuera de estos archivos hay un solo paso manual: en el dashboard,
**Authentication → Sign In / Providers → habilitar "Anonymous sign-ins"**. Sin
eso nadie puede insertar, porque toda escritura pasa por una sesión anónima.

## Qué puede escribir un visitante

Cinco tablas abiertas a escritura anónima — `reports`, `updates`, `offers`,
`mental_health_volunteers` y, solo en parte, `centers` — con la misma forma:
cualquiera lee todo, cualquiera inserta lo suyo, y solo el autor borra lo suyo
(`auth.uid() = user_id`).

`mental_health_volunteers` es la inscripción de quien se ofrece a acompañar a la
comunidad. No tiene nada comunitario —ni RPC, ni policy de UPDATE: está en pie o
se retira— y su única particularidad es el contacto: `contact_phone` y
`contact_instagram` son opcionales por separado, pero un CHECK exige que al menos
uno esté.

**Ninguna tiene policy de UPDATE.** Lo que sí es comunitario pasa por funciones
`security definer` que tocan una sola columna cada una:

| Función | Qué toca | Por qué es comunitaria |
| --- | --- | --- |
| `set_resource_covered(ids, recurso, cubierto)` | `reports.covered` | Quien pasa por la zona sabe si ya llegó el agua |
| `set_report_status(ids, estado)` | `reports.status`, `status_at`, `status_by` | Quien pasa por la zona sabe si está saturado o cerrado |
| `assign_offer(oferta, reporte)` | `offers.report_id`, `assigned_at` | Quien coordina en la calle no es quien publicó la retroexcavadora |
| `set_offer_finished(oferta, finalizada)` | `offers.finished_at` | Quien coordinó la entrega sabe que ya se cumplió; el autor perdió su sesión anónima hace rato |
| `confirm_center(id)` | `centers.updated_at` | Quien pasa por la bodega sabe si sigue abierta; el autor perdió su sesión anónima hace rato |

Las que reciben listas topan en 50 ids por llamada, y todas levantan `errcode
22023` con un mensaje en español, que el cliente muestra tal cual en el toast.

Además, un trigger `throttle_inserts` limita las inserciones por autor y por
minuto: 6 reportes, 10 novedades, 4 ofertas, 4 inscripciones, 3 puntos.

## Los puntos de donación

`centers` es la cuarta tabla: acopios, albergues, bancos de sangre y puntos de
atención de heridos. Dos orígenes conviven ahí, y la columna `origin` los separa.

- **`curado`** — lo escribe un mantenedor con SQL, que corre como `service_role`
  y se salta RLS. `user_id` va nulo.
- **`comunidad`** — lo registra cualquiera desde el formulario del sitio y sale
  al mapa de inmediato, con el pin en un indigo más claro y la etiqueta «Creado
  por la comunidad» en el popup. Los curados llevan la suya, «Creado por la
  alcaldía»: la primera no dice nada si la otra va sin marcar.

La policy de `insert` es la superficie de escritura entera, y es estrecha a
propósito: `origin = 'comunidad'`, `type = 'acopio'`, `is_active`, y `user_id =
auth.uid()`. Los otros tres tipos no se pueden crear desde el navegador: se
insertan a mano hasta que exista un panel de administración.

```sql
insert into public.centers (id, type, name, address, lat, lng, hours, donations)
values (
  'clinica-valle-lili', 'healthcare', 'Clínica Valle del Lili',
  'Cra 98 # 18-49', 3.3736, -76.5195, 'Todos los días, 24 horas',
  array['Vendas', 'Gasas']
);
```

La policy de `delete` deja borrar solo el punto propio y comunitario. **No hay
policy de UPDATE**: ni el autor edita su punto después de publicarlo.

| Campo | Qué cuidar |
| --- | --- |
| `id` | Llave primaria. Slug kebab-case en los curados; uuid en los comunitarios, que pasa el mismo patrón |
| `type` | `acopio`, `albergue`, `sangre` o `healthcare` |
| `origin` | `curado` o `comunidad`. Con `curado`, `user_id` tiene que ir nulo; con `comunidad`, obligatorio (`centers_origin_author`) |
| `donations` | Nombres de insumo del catálogo de `src/scripts/resources.ts`, los mismos de `reports.resources`. Opcional en los cuatro tipos, hasta 80 |
| `accepting_donations` | `false` = sigue abierto pero no recibe. Solo escribe una línea en el popup; el color del pin no cambia |
| `is_active` | `false` = el pin se pinta gris. El punto sigue en el mapa: quien lo vio ayer necesita saber por qué no ir. Retirarlo de verdad es borrar la fila |
| `updated_at` | También el reloj de vencimiento. Solo cuenta en los acopios comunitarios: a las 24 horas se pintan grises hasta que alguien toque «Sigue abierto» |
| `contact_whatsapp` / `contact_instagram` | Opcionales. El usuario de Instagram va sin `@` |
| `lat` / `lng` | Dentro del bounding box de Colombia, igual que un reporte |

**Un acopio comunitario vence a las 24 horas.** Nadie lo retira nunca —el autor
pierde su sesión anónima al limpiar el navegador y no hay policy de UPDATE—, así
que el colegio que recogió donaciones una tarde se quedaba en el mapa como punto
vivo para siempre. Pasadas 24 horas sin que nadie lo toque se dibuja gris, y el
popup ofrece «Sigue abierto» a cualquiera: eso llama a `confirm_center`, que
corre `updated_at` y nada más. El umbral vive en `EXPIRY_HOURS`, en
`src/scripts/centers.ts`; el vencimiento se calcula en el navegador, así que no
hay `pg_cron` ni trabajo agendado que mantener.

El precio de usar `updated_at` como reloj: el trigger `centers_touch_updated_at`
lo corre en **cualquier** update, así que un mantenedor que corrige una tilde en
un acopio comunitario también le reinicia el día. Es el trato — que un
mantenedor toque la fila es evidencia de que el punto existe.

**Promover un punto comunitario** que resultó bueno, para que deje de verse como
sin verificar:

```sql
update public.centers
   set origin = 'curado', user_id = null
 where id = '<uuid>';
```

**Bajar uno malo**: `is_active = false` lo deja gris en el mapa, y borrar la fila
lo retira del todo.

```sql
update public.centers set is_active = false where id = '<uuid>';
delete from public.centers where id = '<uuid>';
```

`donations` guarda nombres de insumo, no ids de categoría: un punto que solo
recibe pañales se publicaba como si recibiera toda la categoría, y el popup
prometía leche en polvo que ahí no reciben. Lo que se pide y lo que se ofrece se
nombran igual, así que se pueden comparar ítem por ítem.

Se valida como `reports.resources` —por largo, no por contenido: hasta 80
elementos (`centers_donations_max`) y hasta 60 caracteres cada uno
(`centers_donations_len`)—. **El catálogo ya no está duplicado fuera del repo**:
agregar una categoría o un insumo en `src/scripts/resources.ts` no pide
migración. El precio es que un nombre mal escrito a mano sale gris, bajo
«Otros», en vez de ser rechazado.

Las filas viejas guardadas por categoría siguen funcionando: `data/centers.ts`
expande al leer cualquier id del catálogo que encuentre, así que escribir
`salud` publica lo mismo de siempre.

Cualquier cambio sale al aire de inmediato, sin deploy: la tabla va en el canal
de realtime y el mapa de quien ya está mirando se repinta solo.

## Cortacircuitos

Si algo se descontrola, esto se corre en el SQL Editor y surte efecto de
inmediato — sin deploy, sin tocar lo ya publicado.

**Dejar una superficie en solo lectura:**

```sql
drop policy "cada quien publica lo suyo" on public.updates;
-- para volver a abrirla:
create policy "cada quien publica lo suyo"
  on public.updates for insert to authenticated
  with check ((select auth.uid()) = user_id);
```

**Revertir un vandalismo de estado.** `status_by` guarda el uuid anónimo de
quien cambió el estado; con él se revierte en bloque:

```sql
select status_by, count(*)
  from public.reports
 where status_at > now() - interval '1 hour'
 group by status_by order by 2 desc;

update public.reports
   set status = 'activo', status_by = null
 where status_by = '<uuid>'
   and status_at > now() - interval '1 hour';
```

**Bajar un teléfono publicado.** Los campos de contacto son opcionales en
`reports` y obligatorios en `offers`, y el autor puede borrar su propia fila
desde el navegador. Cuando no puede (perdió la sesión), un mantenedor con
`service_role` borra por id:

```sql
delete from public.reports where id = '<uuid>';
delete from public.offers  where id = '<uuid>';
```
