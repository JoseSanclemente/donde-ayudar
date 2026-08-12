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

Cuatro tablas abiertas a escritura anónima — `reports`, `updates`, `offers` y,
solo en parte, `centros` — con la misma forma: cualquiera lee todo, cualquiera
inserta lo suyo, y solo el autor borra lo suyo (`auth.uid() = user_id`).

**Ninguna tiene policy de UPDATE.** Lo que sí es comunitario pasa por funciones
`security definer` que tocan una sola columna cada una:

| Función | Qué toca | Por qué es comunitaria |
| --- | --- | --- |
| `set_resource_covered(ids, recurso, cubierto)` | `reports.covered` | Quien pasa por la zona sabe si ya llegó el agua |
| `set_report_status(ids, estado)` | `reports.status`, `status_at`, `status_by` | Quien pasa por la zona sabe si está saturado o cerrado |
| `assign_offer(oferta, reporte)` | `offers.report_id`, `assigned_at` | Quien coordina en la calle no es quien publicó la retroexcavadora |

Todas topan en 50 ids por llamada y levantan `errcode 22023` con un mensaje en
español, que el cliente muestra tal cual en el toast.

Además, un trigger `throttle_inserts` limita las inserciones por autor y por
minuto: 6 reportes, 10 novedades, 4 ofertas, 3 puntos de acopio.

## Los puntos de donación

`centros` es la cuarta tabla: acopios, albergues y bancos de sangre. Dos
orígenes conviven ahí, y la columna `origen` los separa.

- **`curado`** — lo edita un mantenedor en el dashboard (**Table Editor →
  centros**), que corre como `service_role` y se salta RLS. `user_id` va nulo.
- **`comunidad`** — lo registra cualquiera desde el formulario del sitio y sale
  al mapa de inmediato, con el pin en un indigo más claro y la etiqueta «Creado
  por la comunidad» en el popup. Los curados llevan la suya, «Creado por la
  alcaldía»: la primera no dice nada si la otra va sin marcar.

La policy de `insert` es la superficie de escritura entera, y es estrecha a
propósito: `origen = 'comunidad'`, `tipo = 'acopio'`, `activo`, y `user_id =
auth.uid()`. Un albergue, un banco de sangre o cualquier punto curado no se
pueden crear desde el navegador. La de `delete` deja borrar solo el punto propio
y comunitario. **No hay policy de UPDATE**: ni el autor edita su punto después de
publicarlo. Corregir uno es cosa del dashboard.

Antes eran archivos YAML en `src/content/centros/`, validados en cada build. El
costo era el deploy: corregir un horario pedía commit y build de Netlify. Lo que
garantizaba el schema de Zod ahora lo garantizan los CHECK de la tabla.

| Campo | Qué cuidar |
| --- | --- |
| `id` | Llave primaria. Slug kebab-case en los curados —era el nombre del archivo YAML—; uuid en los comunitarios, que pasa el mismo patrón |
| `tipo` | `acopio`, `albergue` o `sangre` |
| `origen` | `curado` o `comunidad`. Con `curado`, `user_id` tiene que ir nulo; con `comunidad`, obligatorio (`centros_origen_autor`) |
| `recibe` | Vacío en `sangre`, y de 1 a 20 en los otros dos |
| `recibiendo` | `false` = sigue abierto pero no recibe: queda gris en el mapa. Vale para los tres tipos — un banco de sangre que ya cubrió su demanda se pausa igual |
| `nota_estado` | Por qué no recibe. Solo se ve con `recibiendo: false` |
| `activo` | `false` = cerrado, deja de dibujarse. No borres la fila |
| `lat` / `lng` | Dentro del bounding box de Colombia, igual que un reporte. Era el de Cali hasta que la ayuda empezó a coordinarse con otros municipios |

**Promover un punto comunitario** que resultó bueno, para que deje de verse como
sin verificar:

```sql
update public.centros
   set origen = 'curado', user_id = null
 where id = '<uuid>';
```

**Bajar uno malo** sin borrarlo, igual que cualquier otro punto cerrado:

```sql
update public.centros set activo = false where id = '<uuid>';
```

El constraint `centros_recibe_ids` lista los ids de categoría a mano. **Es el
único lugar donde el catálogo está duplicado**: si agregas una categoría en
`src/scripts/resources.ts`, agrégala también acá o la tabla la rechaza. Es a
propósito — un id mal escrito acá desaparece un chip del popup sin avisar, y
nadie vuelve a leer una fila que ya guardó.

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
