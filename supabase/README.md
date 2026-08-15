# Base de datos

Dos archivos, una sola verdad:

- **`schema.sql`** — la foto completa. Se corre tal cual, de un solo pegado, en
  el SQL Editor de un proyecto **nuevo**.
- **`migrations/`** — el delta. Es lo que se corre en el proyecto que **ya está
  arriba**. Cada archivo es idempotente: correrlo dos veces no rompe nada.

Cuando cambies el esquema, actualiza los dos: el delta para producción y la foto
para que un proyecto nuevo siga arrancando de una sola corrida.

Fuera de estos archivos hay dos pasos manuales en el dashboard:

1. **Authentication → Sign In / Providers → habilitar "Anonymous sign-ins"**. Sin
   eso nadie puede insertar, porque toda escritura pasa por una sesión anónima.
2. **Authentication → Users → Add user**, un usuario para el bot de WhatsApp
   (`whatsapp-bot@dondeayudar.com.co` sirve). Su uuid es el autor de todas las
   mascotas que publica la Edge Function; ver «Las mascotas por WhatsApp».

## Qué puede escribir un visitante

Seis tablas abiertas a escritura anónima — `reports`, `updates`, `offers`,
`volunteers`, `pets` y, solo en parte, `centers` — con la misma forma: cualquiera lee
todo, cualquiera inserta lo suyo, y solo el autor borra lo suyo (`auth.uid() =
user_id`).

`volunteers` es la inscripción de quien ofrece su tiempo a la comunidad, y `kind`
es su oficio: `salud_mental`, `juridica`, `construccion`, `funeraria` y `otra`.
Es una columna, no un panel: hay **un** panel, quien se inscribe elige su oficio
ahí y la lista se filtra por él. Antes era un panel —y una pestaña— por valor, y
eso fue lo que clasificó mal las inscripciones: un oficio que nadie había
agregado entraba por la pestaña más cercana. `otra` es la válvula de escape para
el que todavía no está en la lista. Agregar un oficio es un valor en el CHECK y
una entrada en `src/scripts/volunteers.ts`; no hace falta otra tabla ni otras
policies. No tiene nada comunitario —ni RPC, ni policy de UPDATE: está en pie o
se retira— y su única particularidad es el contacto: `contact_phone` y
`contact_instagram` son opcionales por separado, pero un CHECK exige que al menos
uno esté.

Sin policy de UPDATE, **reclasificar una inscripción es SQL de mantenedor**, que
corre como `service_role`. Se leen las notas una por una: son texto libre y
adivinar el oficio por palabras sueltas etiqueta mal a una persona.

```sql
select id, kind, name, notes, created_at
  from public.volunteers order by created_at desc;

update public.volunteers set kind = 'construccion' where id = '…';
update public.volunteers set kind = 'funeraria'    where id = '…';
```

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
minuto: 6 reportes, 10 novedades, 4 ofertas, 4 inscripciones, 4 mascotas, 3
puntos. **Quien llega con la `service_role` no cuenta**: no es un navegador —
podría saltarse RLS entera— y frenarlo ahí sería teatro. Lo que sí haría es
romper la Edge Function de WhatsApp, cuyas filas llevan todas el mismo autor.

## Las mascotas encontradas

`pets` es la tabla más pequeña del esquema y la única con un archivo detrás: una
foto, un teléfono y qué animal es (`kind`: `dog`, `cat` u `other`). No lleva
nombre ni dirección — un perro encontrado no tiene dirección, y quien lo perdió
lo reconoce o no —, y el contacto es obligatorio: es para lo que existe la
página. Son tres columnas y el CHECK pide una — `contact_phone`, que es lo único
que escribe el formulario; `contact_username`, que solo llega por el bot; y
`contact_instagram_url`, que solo llega por `scripts/seed-pets.mjs`. Sin RPC y
sin policy de UPDATE, como `volunteers`.

**La foto no está en la fila.** Va al bucket `pets` de Storage y la fila guarda
solo su llave (`photo_path`); los bytes en una columna viajarían en cada evento
de realtime y en cada lectura de la tabla. El bucket es **público**, así que leer
no necesita policy ni URL firmada: las fotos se ven igual que las filas. Escribir
sí: dos policies sobre `storage.objects` que copian las de la tabla — cualquiera
sube a su nombre, solo el dueño borra (`owner = auth.uid()`). El bucket tope en
5 MB y acepta `image/jpeg`, `image/png` e `image/webp`; el navegador revisa lo
mismo antes de subir, en `src/scripts/data/pets.ts`.

El orden de escritura importa y está fijo en el cliente: **primero la foto,
después la fila**. Una fila que apunta a una foto que no subió se ve rota para
todo el mundo y para siempre; un objeto sin fila no lo alcanza nadie. Si es el
insert el que falla, el cliente borra el objeto antes de avisar.

El host de Supabase entra en `img-src` de la CSP por esto — lo escribe
`scripts/headers.mjs` a partir de `PUBLIC_SUPABASE_URL`, igual que `connect-src`.

**La página nunca pide el original.** Una foto que llega por WhatsApp son
1200×1600 y un tercio de mega, y la tarjeta pinta un cuadrado del tamaño de un
dedo: `src/scripts/data/pets.ts` arma dos URL del endpoint de transformación
—400×400 `cover` para la cuadrícula (unos 20 KB, webp si el navegador lo acepta)
y 800×800 `contain` para la ficha—, así que los bytes grandes solo los paga quien
toca una tarjeta. Las dos medidas van siempre juntas: `width` solo **no** conserva
la proporción, porque el `resize` por defecto es `cover` y respeta exactamente lo
que le den — un `width=400` suelto devuelve la foto en 400×1600.

De paso arregla el caché. `/object/public/` responde `Cache-Control: no-cache`,
así que cada visita revalidaba cada foto; `/render/image/public/` responde
`public, max-age=3600`. Las subidas mandan `cacheControl: "31536000"` porque la
llave lleva un uuid y esos bytes no cambian nunca, pero el CDN de transformación
fija su hora igual: lo que se ganó es la hora, no el año.

## Las mascotas por WhatsApp

`pets` tiene un segundo escritor: `supabase/functions/whatsapp-pets`, el único
código de servidor del proyecto. Corre en Supabase y no en Netlify, así que el
sitio sigue siendo estático y el navegador nunca lo llama.

La conversación son tres pasos, porque una foto no dice qué animal es ni si es
macho o hembra, y un mensaje de WhatsApp lleva tres botones como máximo:

1. Llega la foto. Se guarda el **acuse** en `pet_intakes` —el id del mensaje, el
   remitente y el **media id** de Graph— y salen tres botones: Perro / Gato /
   Otro.
2. Llega el toque de la clase. Se guarda en el acuse y salen tres botones más:
   Macho / Hembra / No sé.
3. Llega el toque del sexo. Recién ahí se descarga la foto, se sube al bucket, se
   publica la fila y se borra el acuse.

Descargar en el último paso y no en el primero es para lo que existe la sala de
espera: una foto que nadie termina de clasificar nunca llega al bucket, así que no
hay objetos huérfanos que barrer — solo filas, y esas las barre la función sola
cuando pasan 24 horas. Meta guarda el archivo 30 días; el toque llega en segundos.

**«No sé» se guarda como NULL.** `pets.sex` tiene dos valores y nada más, y una
fila publicada antes de que existiera la pregunta lo lleva igual en NULL: la
tarjeta no pinta el chip y no hay forma de distinguir los dos casos.

**Los reenvíos de Meta.** El paso 3 es idempotente solo, porque el acuse se borra
al publicar. El paso 2 no borra nada, así que el acuse guarda además
`wa_kind_message_id`: si vuelve a llegar el mismo id de mensaje es un reenvío y no
se responde; si llega otro, es alguien corrigiendo la clase antes de contestar la
segunda pregunta, y se le manda otra vez los botones de sexo.

`pet_intakes` tiene RLS **sin una sola policy**: eso es lo que la hace invisible.
`anon` y `authenticated` no ven nada, y solo `service_role` —que se salta RLS—
alcanza un teléfono que todavía no aceptó publicarse. Tampoco va en el canal de
realtime.

**El autor.** No hay `auth.uid()` en una función con `service_role`, y
`pets.user_id` es obligatorio y apunta a `auth.users`. Por eso el usuario del bot
del paso 2 de arriba: su uuid firma todas estas filas. Consecuencia buscada:
nadie las puede borrar desde el navegador —ni la fila ni el objeto, que queda sin
`owner`—, porque nadie las publicó desde un navegador. Bajarlas es el SQL de
«Bajar una foto publicada», más abajo.

**Los secretos** van en Dashboard → Edge Functions → Secrets. `SUPABASE_URL` y
`SUPABASE_SERVICE_ROLE_KEY` los inyecta la plataforma sola.

| Secreto | Qué es |
| --- | --- |
| `WHATSAPP_VERIFY_TOKEN` | La cadena que uno inventa y repite en Meta al guardar la callback url |
| `WHATSAPP_APP_SECRET` | App secret de la app de Meta. Firma cada webhook (`x-hub-signature-256`); sin esa verificación cualquiera que sepa la url publica una mascota |
| `WHATSAPP_TOKEN` | Token de acceso del número. Sirve para bajar el archivo y para responder |
| `WHATSAPP_PHONE_NUMBER_ID` | El id del número que manda las respuestas |
| `PETS_BOT_USER_ID` | El uuid del usuario del bot |

**El despliegue** va con `verify_jwt = false` —Meta no manda `Authorization`—, y
`supabase/config.toml` lo deja escrito para que un deploy desde el CLI no lo
vuelva a prender. La callback url es
`https://<project-ref>.supabase.co/functions/v1/whatsapp-pets`.

**Cerrar la entrada** es quitar la callback url en Meta, o borrar la función. Lo
ya publicado no se toca.

## Las mascotas de una tanda

`pets` tiene un tercer escritor y es el único que corre desde una terminal:
`scripts/seed-pets.mjs`, para una tanda recogida por fuera del sitio —de
Instagram— que ni el formulario ni el bot pueden recibir. Se corre a mano:

```
pnpm pets:seed -- --dry-run   # valida y no toca nada
pnpm pets:seed                # publica
```

**El contacto es un enlace, no un teléfono.** Ni `contact_phone` ni
`contact_username` admiten una URL —los dos patrones prohíben `:` y `/`— y el
segundo se dibuja como `wa.me/<usuario>`, así que un valor de Instagram ahí
abriría un chat que no existe. Por eso `contact_instagram_url`, que guarda el
permalink de la publicación, y el botón de la tarjeta la abre. El nombre no es
`contact_instagram` a propósito: en `centers` y `volunteers` esa columna guarda
un usuario pelado y sus helpers arman un enlace al perfil, que es otra cosa. El
CHECK de contacto ahora pide **una de las tres**.

**El autor** es el mismo usuario del bot (`PETS_BOT_USER_ID`), por lo mismo que
la función: `pets.user_id` es obligatorio y apunta a `auth.users`. Estas filas
quedan igual de intocables desde el navegador —el objeto no tiene `owner`—, así
que bajarlas es el SQL de «Bajar una foto publicada», más abajo.

**Las credenciales** van en `.env`, que no se commitea, y no en `.env.example`,
que solo lleva las dos públicas: `SUPABASE_SERVICE_ROLE_KEY` (Dashboard →
Project Settings → API) y `PETS_BOT_USER_ID`. Con `service_role` el script se
salta RLS y también el trigger `pets_throttle`, que si no dejaría pasar cuatro
filas por minuto.

**La tanda** es `scripts/pets-seed.json`, un arreglo de
`{ image_url, kind, sex, instagram }` — `scripts/pets-seed.example.json` tiene la
forma. Está en `.gitignore`. El script escribe el `id` de vuelta en cada entrada
publicada y salta las que ya lo tienen, así que volver a correrlo después de una
falla a mitad de camino no duplica nada. La foto se sube antes que la fila y el
objeto se borra si el insert falla, igual que en los otros dos escritores.

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

**Bajar una foto publicada.** Borrar la fila de `pets` la saca de la página, pero
el objeto sigue en el bucket y su URL pública sigue viva: son dos borrados, y el
del objeto va después. Con `service_role`:

```sql
select id, photo_path from public.pets where id = '<uuid>';

delete from storage.objects
 where bucket_id = 'pets' and name = '<photo_path>';
delete from public.pets where id = '<uuid>';
```

Para dejar de recibir fotos sin tocar lo publicado, la superficie de subida se
cierra sola:

```sql
drop policy "anyone uploads a pet photo" on storage.objects;
```
