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
que escribe el formulario; `contact_username`, que llega por el bot y por
`scripts/seed-pets.mjs`, que es como se publica la tanda de una organización que
contesta en un solo chat; y `contact_instagram_url`, que solo llega por el
seeder. Sin RPC y sin policy de UPDATE, como `volunteers`.

**`place_name` es dónde está el animal**, cuando está en un lugar con nombre: una
veterinaria, un albergue, una organización. No es una dirección — quien busca a su
perro necesita saber quién lo tiene, no la esquina donde apareció — y es opcional:
la mayoría de las filas no lo lleva, porque quien recoge un perro en la calle lo
tiene en su casa, y entonces la tarjeta no pinta la línea. **No lo escribe el
navegador**: no hay campo en el formulario ni paso en el bot. Lo escribe el
mantenedor, de dos maneras y las dos con `service_role` — el seeder, cuando la
tanda entera viene de un lugar con nombre, y SQL suelto para una fila que ya
está publicada, que no hay policy de UPDATE:

```sql
update public.pets set place_name = 'Veterinaria La 14' where id = '<uuid>';
```

Tope de 120 caracteres, la misma forma que `reports.place_name`.

**`ref_code` es el código que la mascota ya tenía en el registro de quien pasó la
tanda** (`ROYI-00012`). Una tanda comparte un solo contacto, así que quien recibe
«Escribir al WhatsApp» no tiene con qué distinguir veinte mensajes sobre veinte
animales: el código viaja en el `?text=` del botón y en el enlace que abre la
ficha (`/mascotas?mascota=ROYI-00012`). Opcional, y solo lo escribe el seeder —
una mascota publicada desde el formulario o desde el bot no tiene registro
detrás. Es un CHECK de forma y no una llave foránea: no hay tabla de sistemas
ajenos, y lo que el patrón evita es que la columna se vuelva texto libre que
termina en una URL.

**Retirar una tanda** no se puede desde el navegador: borrar es del autor
(`auth.uid() = user_id`) y una tanda la firma el usuario del bot, cuya sesión no
tiene nadie. Para eso está `scripts/delete-pets.mjs`, que toma el `place_name`,
borra las filas y después las fotos del bucket — el mismo orden que el cliente —
y no toca nada sin `--apply`:

```
node --env-file=.env scripts/delete-pets.mjs "Royi Pets" --apply
```

**El contacto no se lee con la tabla.** `contact_phone`, `contact_username` y
`contact_instagram_url` no tienen SELECT para `anon` ni para `authenticated`: la
página lee doscientas filas de una y con ellas viajaban doscientos teléfonos, que
es una lista y no un contacto. El privilegio de tabla se quitó y se devolvió
columna por columna sin esas tres — en ese orden, porque una columna no se puede
revocar de un grant hecho sobre la tabla entera. La policy de SELECT no cambió:
RLS filtra filas y esto son columnas, y las dos hacen falta.

Quien necesita un contacto llama a `pet_contact(<uuid>)`, que devuelve el de una
sola mascota y es `security definer`. La ficha lo pide al abrirse y la tarjeta de
escritorio al pasar el mouse, en `src/scripts/features/pets-grid.ts`. Consultar
uno a mano:

```sql
select * from public.pet_contact('<uuid>');
```

`service_role` no está tocado: el bot, el seeder y el dashboard siguen leyendo
las tres columnas. Deshacer el cambio entero es un `grant`:

```sql
grant select on public.pets to anon, authenticated;
```

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

## La tanda de Royi

`scripts/fetch-royi-pets.mjs` baja las mascotas que Royi publica en su propio
sitio (https://royipets.netlify.app) y deja el archivo que come el seeder. El
sitio es una página estática sobre Firestore y su colección `pets` se lee con la
llave web que la propia página trae en el HTML, así que no hay que raspar
marcado: se le piden los documentos a la API REST. La foto tampoco es un archivo
allá — vive en otra colección como data url en base64 —, y de acá sale un jpeg
por mascota en `scripts/.royi-photos/`.

Tres cosas que el recolector decide y conviene saber:

- **Solo las que todavía buscan familia**: se descarta `archivado`, el `estado`
  «Adoptado» o «Encontró sus dueños», y la `ubicacion` que dice lo mismo — hay
  filas con «Disponible» y ubicación «Adoptado», y entre las dos gana la que
  cierra.
- **Solo Cali.** Royi también recibe animales de fuera y el `lugarSector` lo
  dice; publicar un perro de Jamundí acá es ponerlo en una cuadrícula que quien
  lo busca no va a mirar. La dirección es texto libre y a veces nombra el
  municipio con el sector todavía en Cali: eso no se descarta solo, se avisa al
  final para revisarlo a ojo.
- **El contacto no se lee del origen.** Los teléfonos de Royi están en una
  colección privada que no es pública, así que la tanda entera lleva el usuario
  de WhatsApp que ellos dieron (`contact_username`), el `place_name` de quien
  responde y el `ref_code` de cada animal, que es lo que distingue un mensaje de
  otro. Las filas las firma el usuario del bot, como toda tanda sembrada.

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
3. Llega el toque del sexo. Se guarda en el acuse, y para quien ya contestó la
   pregunta del paso 4 acá se descarga la foto, se sube al bucket, se publica la
   fila y se borra el acuse.

Y un cuarto paso la primera vez, y solo la primera:

4. Publicar la foto publica también la forma de escribirle a quien la mandó — su
   número, o su usuario cuando el número está detrás de uno. Antes eso se avisaba
   en el paso 1 y se daba por aceptado con el toque del paso 3. Avisar no es
   preguntar: a quien no le hemos preguntado le salen dos botones —«Sí, publicar»
   / «No»— y es ese toque el que publica. La respuesta va a `pet_senders` y no se
   vuelve a preguntar nunca: la segunda foto de quien dijo que sí sigue siendo de
   tres toques.

Un **no** no es publicar sin contacto: el CHECK de `pets` pide uno de los tres y
una foto por la que nadie puede escribir no la reclama nadie. Es descartar la
foto, y se le dice. Un no queda guardado igual, y si esa persona manda otra foto
meses después se le vuelve a preguntar — lo contrario es que sus fotos se mueran
en silencio para siempre.

**`pet_senders`** es la memoria que `pet_intakes` no puede ser, porque esa se
borra al publicar. La llave es la misma dirección que `wa_from`: los dígitos, o
el user id de quien escribe desde un usuario. Se guarda en claro y no como hash a
propósito — es la constancia de un consentimiento, y una constancia ilegible no
prueba nada — con las mismas defensas que `pet_intakes`: RLS encendida, ni una
policy, fuera de realtime. Nadie la barre: un «ya preguntamos» con vencimiento es
volver a preguntarle a quien ya contestó.

Ver o corregir una respuesta es SQL de mantenedor:

```sql
select * from public.pet_senders where wa_from = '573001112233';
-- Volver a preguntarle a alguien: borrar su fila.
delete from public.pet_senders where wa_from = '573001112233';
```

Descargar en el último paso y no en el primero es para lo que existe la sala de
espera: una foto que nadie termina de clasificar nunca llega al bucket, así que no
hay objetos huérfanos que barrer — solo filas, y esas las barre la función sola
cuando pasan 24 horas. Meta guarda el archivo 30 días; el toque llega en segundos.

**«No sé» se guarda como NULL.** `pets.sex` tiene dos valores y nada más, y una
fila publicada antes de que existiera la pregunta lo lleva igual en NULL: la
tarjeta no pinta el chip y no hay forma de distinguir los dos casos.

**Los reenvíos de Meta.** El paso 4 es idempotente solo, porque el acuse se borra
al publicar y también al descartar. Los pasos 2 y 3 no borran nada, así que el
acuse guarda `wa_kind_message_id` y `wa_sex_message_id`: si vuelve a llegar el
mismo id de mensaje es un reenvío y no se responde; si llega otro, es alguien
corrigiendo su respuesta antes de contestar la siguiente pregunta, y se le mandan
otra vez los botones que siguen.

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

`centers` es la cuarta tabla: acopios, albergues, bancos de sangre, puntos de
atención de heridos y municipios que piden ayuda. Dos orígenes conviven ahí, y la
columna `origin` los separa.

- **`curado`** — lo escribe un mantenedor con SQL, que corre como `service_role`
  y se salta RLS. `user_id` va nulo.
- **`comunidad`** — lo registra cualquiera desde el formulario del sitio y sale
  al mapa de inmediato, con el pin en un indigo más claro y la etiqueta «Creado
  por la comunidad» en el popup. Los curados llevan la suya, «Creado por la
  alcaldía»: la primera no dice nada si la otra va sin marcar.

La policy de `insert` es la superficie de escritura entera, y es estrecha a
propósito: `origin = 'comunidad'`, `type = 'acopio'`, `is_active`, y `user_id =
auth.uid()`. Los otros cuatro tipos no se pueden crear desde el navegador: se
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
| `type` | `acopio`, `albergue`, `sangre`, `healthcare` o `municipio` |
| `origin` | `curado` o `comunidad`. Con `curado`, `user_id` tiene que ir nulo; con `comunidad`, obligatorio (`centers_origin_author`) |
| `donations` | Nombres de insumo del catálogo de `src/scripts/resources.ts`, los mismos de `reports.resources`. Opcional en los cuatro tipos, hasta 80 |
| `accepting_donations` | `false` = sigue abierto pero no recibe. Solo escribe una línea en el popup; el color del pin no cambia |
| `is_active` | `false` = el pin se pinta gris. El punto sigue en el mapa: quien lo vio ayer necesita saber por qué no ir. Retirarlo de verdad es borrar la fila |
| `updated_at` | También el reloj de vencimiento, y se lee de dos maneras. En un acopio comunitario: a las 24 horas se pinta gris hasta que alguien toque «Sigue abierto». En un `municipio`: a los 30 días se cae del mapa (ver más abajo) |
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

### Los municipios que piden ayuda

`type = 'municipio'` es el único punto que no es una puerta. No es un lugar al
que alguien camina: es un pueblo entero que quedó necesitando algo, leído de la
prensa y publicado por un mantenedor. **Tampoco es solo del Valle**: el epicentro
del terremoto quedó en San José del Palmar y 29 de los 31 municipios del Chocó
resultaron golpeados, así que el mapa se sale del departamento por acá y por
ningún otro lado. El botón de alejar encuadra lo que haya dibujado —
`flyToEmergency` en `src/scripts/map.ts` — así que sigue a los pines a donde
vayan; lo único atado a una región es `EMERGENCY_BOUNDS`, el respaldo para
cuando no hay nada dibujado, y hoy cubre Valle y Chocó. La coordenada es la cabecera, no una
dirección, y por eso el pin es más grande y más redondo que el del acopio —
prometer la precisión de una esquina sería mentir sobre lo que la fila sostiene.
`hours` va vacío: un municipio no tiene horario. El popup no dice «Recibe» sino
«Necesita»: los chips son de lo que le hace falta, no de lo que reparte.

Solo se escribe con SQL. La policy de `insert` ya fija `type = 'acopio'`, así que
el navegador no puede crear uno, y `confirm_center` ya exige un acopio
comunitario, así que ningún visitante puede alargarle la vida a un municipio. Eso
último es el punto entero: lo que envejece acá es la noticia de la que salió la
fila, y quien camina por el frente no puede contestar por un pueblo.

**Un municipio dura 30 días y después se cae del mapa.** No se pone gris —eso
hace un acopio vencido— porque el cuadrito gris dice «este lugar existe, no
vayas todavía», y acá lo que envejeció es la afirmación misma: que este municipio
sigue necesitando lo que necesitaba hace un mes. El umbral es `MUNICIPIO_DAYS` en
`src/scripts/centers.ts` y se calcula en el navegador, igual que el de los
acopios: no hay `pg_cron` ni trabajo agendado.

**La barrida, cada 30 días.** Es la única tarea recurrente del proyecto. Primero,
qué está por caerse:

```sql
select id, name, updated_at, now() - updated_at as edad
  from public.centers
 where type = 'municipio'
 order by updated_at;
```

Después se vuelve a buscar en la prensa y, municipio por municipio, se decide:

```sql
-- Sigue necesitando: otros 30 días.
update public.centers set updated_at = now() where id = 'municipio-el-cairo';

-- Ya no: se retira del todo.
delete from public.centers where id = 'municipio-vijes';
```

Acá el trigger `centers_touch_updated_at` juega a favor y no en contra: tocar la
fila para corregir una tilde también le da 30 días más, y que un mantenedor la
toque es evidencia de que volvió a mirar la noticia. Es lo contrario de lo que
pasa con un acopio, donde el mismo trigger reinicia un reloj que nadie quería
mover.

**La tanda del terremoto del 10 de agosto de 2026.** Coordenadas tomadas de los
nodos `place` de OSM (la cabecera, no el centroide del municipio: en Chocó los
dos se separan hasta 15 km), y `donations` con nombres exactos del catálogo de
`src/scripts/resources.ts`. `notes` lleva la cifra y la fuente: los puntos
curados pasan por `linkifyHtml`, así que la URL queda cliqueable en el popup.

Primero el Valle:

```sql
insert into public.centers (id, type, name, address, lat, lng, donations, notes)
values
  ('municipio-el-cairo', 'municipio', 'El Cairo',
   'Cabecera municipal, El Cairo, Valle del Cauca', 4.7622, -76.2208,
   array['Agua','Enlatados','Arroz','Aceite','Colchonetas','Cobijas','Carpas','Jabón de cuerpo','Papel higiénico','Pañales','Baños portátiles','Plantas eléctricas','Linternas'],
   'Se perdió cerca del 80% del casco urbano. Fuente: El País — https://www.elpais.com.co/valle/el-aguila-el-cairo-buenaventura-y-roldanillo-entre-los-mas-afectados-asi-puede-ayudar-1233.html'),

  ('municipio-el-aguila', 'municipio', 'El Águila',
   'Cabecera municipal, El Águila, Valle del Cauca', 4.9078, -76.0422,
   array['Agua','Enlatados','Arroz','Aceite','Colchonetas','Cobijas','Carpas','Jabón de cuerpo','Papel higiénico','Pañales','Crema dental','Cepillo de dientes'],
   'Cerca del 70% de la infraestructura municipal con afectaciones graves. Fuente: El País — https://www.elpais.com.co/valle/el-aguila-el-cairo-buenaventura-y-roldanillo-entre-los-mas-afectados-asi-puede-ayudar-1233.html'),

  ('municipio-roldanillo', 'municipio', 'Roldanillo',
   'Cabecera municipal, Roldanillo, Valle del Cauca', 4.4091, -76.1544,
   array['Agua','Enlatados','Arroz','Aceite','Colchonetas','Cobijas','Carpas','Jabón de cuerpo','Papel higiénico','Pañales','Gasas','Solución salina','Acetaminofén','Baños portátiles'],
   'Cerca de 1.200 viviendas afectadas, unas 500 destruidas; el hospital principal quedó con el 60% de su estructura comprometida. Fuente: El Colombiano — https://www.elcolombiano.com/inicio/afectaciones-terremoto-roldanillo-valle-del-cauca-danos-DF39870021'),

  ('municipio-versalles', 'municipio', 'Versalles',
   'Cabecera municipal, Versalles, Valle del Cauca', 4.5748, -76.1997,
   array['Agua','Enlatados','Arroz','Aceite','Colchonetas','Cobijas','Carpas','Jabón de cuerpo','Papel higiénico','Pañales','Linternas','Pilas AA','Leche en polvo'],
   'El puente entre Versalles y La Unión quedó destruido y complicó la movilidad en el norte del Valle. Fuente: La FM — https://www.lafm.com.co/actualidad/terremoto-colombia-estos-son-los-municipios-mas-afectados-en-el-valle-del-cauca-407751'),

  ('municipio-la-victoria', 'municipio', 'La Victoria',
   'Cabecera municipal, La Victoria, Valle del Cauca', 4.5233, -76.0358,
   array['Agua','Enlatados','Arroz','Aceite','Colchonetas','Cobijas','Carpas','Jabón de cuerpo','Papel higiénico','Pañales'],
   'Más de 600 viviendas con algún tipo de afectación. Fuente: El País — https://www.elpais.com.co/valle/el-aguila-el-cairo-buenaventura-y-roldanillo-entre-los-mas-afectados-asi-puede-ayudar-1233.html'),

  ('municipio-buenaventura', 'municipio', 'Buenaventura',
   'Cabecera municipal, Buenaventura, Valle del Cauca', 3.8882, -77.0738,
   array['Agua','Enlatados','Arroz','Aceite','Colchonetas','Cobijas','Carpas','Jabón de cuerpo','Papel higiénico','Pañales'],
   'Entre los municipios con especial afectación por el terremoto. Fuente: El País — https://www.elpais.com.co/valle/el-aguila-el-cairo-buenaventura-y-roldanillo-entre-los-mas-afectados-asi-puede-ayudar-1233.html'),

  ('municipio-argelia', 'municipio', 'Argelia',
   'Cabecera municipal, Argelia, Valle del Cauca', 4.7266, -76.1215,
   array['Agua','Enlatados','Arroz','Aceite','Colchonetas','Cobijas','Carpas','Jabón de cuerpo','Papel higiénico','Pañales'],
   'Alta afectación por el terremoto del 10 de agosto; tiene padrino en el Plan Padrino entre Alcaldes. Fuente: El País — https://www.elpais.com.co/valle/seis-municipios-del-valle-del-cauca-tendran-padrinos-de-otras-regiones-del-pais-tras-el-terremoto-fedemunicipios-1422.html'),

  ('municipio-calima-darien', 'municipio', 'Calima (El Darién)',
   'Cabecera municipal, Calima, Valle del Cauca', 3.9318, -76.4842,
   array['Agua','Enlatados','Arroz','Aceite','Colchonetas','Cobijas','Carpas','Jabón de cuerpo','Papel higiénico','Pañales'],
   'Alta afectación por el terremoto del 10 de agosto; tiene padrino en el Plan Padrino entre Alcaldes. Fuente: El País — https://www.elpais.com.co/valle/seis-municipios-del-valle-del-cauca-tendran-padrinos-de-otras-regiones-del-pais-tras-el-terremoto-fedemunicipios-1422.html'),

  ('municipio-vijes', 'municipio', 'Vijes',
   'Cabecera municipal, Vijes, Valle del Cauca', 3.7004, -76.4429,
   array['Agua','Enlatados','Arroz','Aceite','Colchonetas','Cobijas','Carpas','Jabón de cuerpo','Papel higiénico','Pañales'],
   'Alta afectación por el terremoto del 10 de agosto; tiene padrino en el Plan Padrino entre Alcaldes. Fuente: El País — https://www.elpais.com.co/valle/seis-municipios-del-valle-del-cauca-tendran-padrinos-de-otras-regiones-del-pais-tras-el-terremoto-fedemunicipios-1422.html'),

  ('municipio-san-pedro', 'municipio', 'San Pedro',
   'Cabecera municipal, San Pedro, Valle del Cauca', 3.9956, -76.2280,
   array['Agua','Enlatados','Arroz','Aceite','Colchonetas','Cobijas','Carpas','Jabón de cuerpo','Papel higiénico','Pañales'],
   'Alta afectación por el terremoto del 10 de agosto; tiene padrino en el Plan Padrino entre Alcaldes. Fuente: El País — https://www.elpais.com.co/valle/seis-municipios-del-valle-del-cauca-tendran-padrinos-de-otras-regiones-del-pais-tras-el-terremoto-fedemunicipios-1422.html'),

  ('municipio-zarzal', 'municipio', 'Zarzal',
   'Cabecera municipal, Zarzal, Valle del Cauca', 4.3939, -76.0706,
   array['Agua','Enlatados','Arroz','Aceite','Colchonetas','Cobijas','Carpas','Jabón de cuerpo','Papel higiénico','Pañales'],
   'Nombrado entre los municipios más afectados por el terremoto del 10 de agosto. Fuente: La FM — https://www.lafm.com.co/actualidad/terremoto-colombia-estos-son-los-municipios-mas-afectados-en-el-valle-del-cauca-407751'),

  ('municipio-sevilla', 'municipio', 'Sevilla',
   'Cabecera municipal, Sevilla, Valle del Cauca', 4.2645, -75.9344,
   array['Agua','Enlatados','Arroz','Aceite','Colchonetas','Cobijas','Carpas','Jabón de cuerpo','Papel higiénico','Pañales'],
   'Nombrado entre los municipios más afectados por el terremoto del 10 de agosto. Fuente: La FM — https://www.lafm.com.co/actualidad/terremoto-colombia-estos-son-los-municipios-mas-afectados-en-el-valle-del-cauca-407751'),

  ('municipio-ulloa', 'municipio', 'Ulloa',
   'Cabecera municipal, Ulloa, Valle del Cauca', 4.7037, -75.7379,
   array['Agua','Enlatados','Arroz','Aceite','Colchonetas','Cobijas','Carpas','Jabón de cuerpo','Papel higiénico','Pañales'],
   'Nombrado entre los municipios más afectados por el terremoto del 10 de agosto. Fuente: La FM — https://www.lafm.com.co/actualidad/terremoto-colombia-estos-son-los-municipios-mas-afectados-en-el-valle-del-cauca-407751'),

  ('municipio-la-union', 'municipio', 'La Unión',
   'Cabecera municipal, La Unión, Valle del Cauca', 4.5319, -76.1032,
   array['Agua','Enlatados','Arroz','Aceite','Colchonetas','Cobijas','Carpas','Jabón de cuerpo','Papel higiénico','Pañales'],
   'Nombrado entre los municipios más afectados por el terremoto del 10 de agosto. Fuente: La FM — https://www.lafm.com.co/actualidad/terremoto-colombia-estos-son-los-municipios-mas-afectados-en-el-valle-del-cauca-407751'),

  ('municipio-yotoco', 'municipio', 'Yotoco',
   'Cabecera municipal, Yotoco, Valle del Cauca', 3.8611, -76.3852,
   array['Agua','Enlatados','Arroz','Aceite','Colchonetas','Cobijas','Carpas','Jabón de cuerpo','Papel higiénico','Pañales'],
   'Nombrado entre los municipios más afectados por el terremoto del 10 de agosto. Fuente: La FM — https://www.lafm.com.co/actualidad/terremoto-colombia-estos-son-los-municipios-mas-afectados-en-el-valle-del-cauca-407751'),

  ('municipio-la-cumbre', 'municipio', 'La Cumbre',
   'Cabecera municipal, La Cumbre, Valle del Cauca', 3.6506, -76.5699,
   array['Agua','Enlatados','Arroz','Aceite','Colchonetas','Cobijas','Carpas','Jabón de cuerpo','Papel higiénico','Pañales'],
   'Nombrado entre los municipios más afectados por el terremoto del 10 de agosto. Fuente: La FM — https://www.lafm.com.co/actualidad/terremoto-colombia-estos-son-los-municipios-mas-afectados-en-el-valle-del-cauca-407751'),

  ('municipio-riofrio', 'municipio', 'Riofrío',
   'Cabecera municipal, Riofrío, Valle del Cauca', 4.1558, -76.2876,
   array['Agua','Enlatados','Arroz','Aceite','Colchonetas','Cobijas','Carpas','Jabón de cuerpo','Papel higiénico','Pañales'],
   'Nombrado entre los municipios más afectados por el terremoto del 10 de agosto. Fuente: La FM — https://www.lafm.com.co/actualidad/terremoto-colombia-estos-son-los-municipios-mas-afectados-en-el-valle-del-cauca-407751');
```

Y el Chocó, que en proporción quedó peor: el 93% del departamento con daños
graves, 43.000 damnificados y el epicentro adentro. Los cinco primeros llevan
cifra propia; Condoto y Nóvita entran por el conteo de 29 de 31 municipios y no
por un dato suyo.

```sql
insert into public.centers (id, type, name, address, lat, lng, donations, notes)
values
  ('municipio-san-jose-del-palmar', 'municipio', 'San José del Palmar',
   'Cabecera municipal, San José del Palmar, Chocó', 4.8959, -76.2345,
   array['Agua','Enlatados','Arroz','Aceite','Colchonetas','Cobijas','Carpas','Jabón de cuerpo','Papel higiénico','Pañales','Linternas','Pilas AA','Plantas eléctricas','Baños portátiles'],
   'Epicentro del terremoto. 442 viviendas afectadas y cerca de 40 colapsadas; 75 derrumbes en vías terciarias. Fuente: El Tiempo — https://www.eltiempo.com/unidad-investigativa/el-93-del-choco-sufrio-graves-danos-por-terremoto-van-14-muertos-y-43-000-damnificados-3578063'),

  ('municipio-istmina', 'municipio', 'Istmina',
   'Cabecera municipal, Istmina, Chocó', 5.1593, -76.6855,
   array['Agua','Enlatados','Arroz','Aceite','Colchonetas','Cobijas','Carpas','Jabón de cuerpo','Papel higiénico','Pañales','Baños portátiles','Leche en polvo'],
   '550 viviendas afectadas y más de 3.000 damnificados. Fuente: El Tiempo — https://www.eltiempo.com/unidad-investigativa/el-93-del-choco-sufrio-graves-danos-por-terremoto-van-14-muertos-y-43-000-damnificados-3578063'),

  ('municipio-quibdo', 'municipio', 'Quibdó',
   'Cabecera municipal, Quibdó, Chocó', 5.6913, -76.6531,
   array['Agua','Enlatados','Arroz','Aceite','Colchonetas','Cobijas','Carpas','Jabón de cuerpo','Papel higiénico','Pañales','Solución salina','Gasas','Esparadrapo','Alcohol','Isodine','Caja de guantes de látex','Acetaminofén','Equipo de macrogoteo'],
   'El hospital San Francisco de Asís quedó con afectaciones graves y al 300% de su capacidad. Fuente: El Tiempo — https://www.eltiempo.com/unidad-investigativa/fotos-sos-por-el-departamento-del-choco-asi-estan-varios-de-sus-municipios-afectados-tras-el-fuerte-terremoto-3577877'),

  ('municipio-sipi', 'municipio', 'Sipí',
   'Cabecera municipal, Sipí, Chocó', 4.6532, -76.6441,
   array['Agua','Enlatados','Arroz','Aceite','Colchonetas','Cobijas','Carpas','Jabón de cuerpo','Papel higiénico','Pañales','Linternas','Pilas AA'],
   'Varias viviendas colapsadas y establecimientos comerciales destruidos. Fuente: El Tiempo — https://www.eltiempo.com/unidad-investigativa/fotos-sos-por-el-departamento-del-choco-asi-estan-varios-de-sus-municipios-afectados-tras-el-fuerte-terremoto-3577877'),

  ('municipio-litoral-del-san-juan', 'municipio', 'El Litoral del San Juan',
   'Docordó, El Litoral del San Juan, Chocó', 4.2580, -77.3647,
   array['Agua','Enlatados','Arroz','Aceite','Colchonetas','Cobijas','Carpas','Jabón de cuerpo','Papel higiénico','Pañales','Linternas','Pilas AA'],
   'Viviendas completamente destruidas; la alcaldía pide todo el apoyo posible. Fuente: El Tiempo — https://www.eltiempo.com/unidad-investigativa/fotos-sos-por-el-departamento-del-choco-asi-estan-varios-de-sus-municipios-afectados-tras-el-fuerte-terremoto-3577877'),

  ('municipio-condoto', 'municipio', 'Condoto',
   'Cabecera municipal, Condoto, Chocó', 5.0922, -76.6514,
   array['Agua','Enlatados','Arroz','Aceite','Colchonetas','Cobijas','Carpas','Jabón de cuerpo','Papel higiénico','Pañales'],
   'Entre los 29 de 31 municipios del Chocó con afectaciones por el terremoto del 10 de agosto. Fuente: El Tiempo — https://www.eltiempo.com/unidad-investigativa/el-93-del-choco-sufrio-graves-danos-por-terremoto-van-14-muertos-y-43-000-damnificados-3578063'),

  ('municipio-novita', 'municipio', 'Nóvita',
   'Cabecera municipal, Nóvita, Chocó', 4.9554, -76.6068,
   array['Agua','Enlatados','Arroz','Aceite','Colchonetas','Cobijas','Carpas','Jabón de cuerpo','Papel higiénico','Pañales'],
   'Entre los 29 de 31 municipios del Chocó con afectaciones por el terremoto del 10 de agosto. Fuente: El Tiempo — https://www.eltiempo.com/unidad-investigativa/el-93-del-choco-sufrio-graves-danos-por-terremoto-van-14-muertos-y-43-000-damnificados-3578063');
```

Y Risaralda con Caldas, que entraron después: Risaralda es el segundo
departamento con más muertos —104 el 13 de agosto, detrás de los 148 del Valle— y
no tenía un solo pin. Los 14 municipios de Risaralda van completos porque la
gobernación declaró la calamidad pública sobre los 14; Pereira, Dosquebradas y
Manizales llevan cifra propia y los otros doce entran con esa declaratoria y la
lista genérica, que es el mismo escalón donde ya están Zarzal y Sevilla.

⚠ **Ojo con dos nombres.** Hay un municipio llamado *Risaralda* dentro de Caldas,
distinto del departamento, y hay *Santuario*, *Balboa* y *Pueblo Rico* en más de
un departamento del país — por eso esos slugs llevan el departamento pegado
(`municipio-santuario-risaralda`, `municipio-balboa-risaralda`,
`municipio-pueblo-rico-risaralda`). El nodo `place` de Pueblo Rico también sale
dos veces en OSM: la vereda de Caldas y el pueblo de Risaralda, que es el de
16.156 habitantes.

Los tres con cifra propia van con la forma de arriba. Los doce restantes dicen
todos lo mismo salvo el nombre y las coordenadas, así que van en una sola
sentencia — menos superficie para una errata que doce bloques copiados:

```sql
insert into public.centers (id, type, name, address, lat, lng, donations, notes)
select
  'municipio-' || slug, 'municipio', nombre,
  'Cabecera municipal, ' || nombre || ', Risaralda', lat, lng,
  array['Agua','Enlatados','Arroz','Aceite','Colchonetas','Cobijas','Carpas','Jabón de cuerpo','Papel higiénico','Pañales'],
  'Cubierto por la calamidad pública que Risaralda declaró para sus 14 municipios. Fuente: Semana — https://www.semana.com/nacion/regionales/articulo/gobernacion-de-risaralda-declara-calamidad-publica-y-urgencia-manifiesta-tras-terremoto-en-colombia/202649/'
from (values
  ('santa-rosa-de-cabal',      'Santa Rosa de Cabal', 4.8651, -75.6212),
  ('la-virginia',              'La Virginia',         4.8996, -75.8826),
  ('marsella',                 'Marsella',            4.9368, -75.7390),
  ('belen-de-umbria',          'Belén de Umbría',     5.2009, -75.8690),
  ('apia',                     'Apía',                5.1066, -75.9425),
  ('santuario-risaralda',      'Santuario',           5.0732, -75.9625),
  ('la-celia',                 'La Celia',            5.0034, -76.0032),
  ('balboa-risaralda',         'Balboa',              4.9511, -75.9591),
  ('quinchia',                 'Quinchía',            5.3376, -75.7295),
  ('guatica',                  'Guática',             5.3156, -75.8008),
  ('mistrato',                 'Mistrató',            5.2958, -75.8826),
  ('pueblo-rico-risaralda',    'Pueblo Rico',         5.2216, -76.0302)
) as m(slug, nombre, lat, lng);
```

Para ver lo que quedó de estos dos departamentos (los paréntesis no sobran: `and`
amarra más fuerte que `or`, y sin ellos la consulta trae cualquier fila de Caldas
sea del tipo que sea):

```sql
select id, name, address, lat, lng from public.centers
 where type = 'municipio'
   and (address like '%Risaralda' or address like '%Caldas')
 order by name;
```

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

## Las cifras de la emergencia

`stats` es la primera tabla del proyecto cuyas filas son **afirmaciones sobre el
mundo** y no sobre sus propios usuarios: cuántos muertos, cuántas viviendas,
cuánta gente. Un número equivocado acá es desinformación en una página de
emergencia, que no es lo mismo que un pin equivocado, y de ahí sale todo lo
demás.

**No tiene policy de insert, ni de update, ni de delete.** Es la superficie de
escritura más angosta del proyecto —`centers` al menos deja registrar un acopio—
y escribe solo `service_role`, o sea un mantenedor en el editor de SQL. Tampoco
entra en el freno de inserciones: no hay quién la golpee.

**Una fila es un corte entero.** La UNGRD publicó un balance nuevo casi cada día
—239 muertos el 12 de agosto, 273 el 13, 281, 287, 288, 294 el 15— y a veces más
de uno el mismo día, por eso `cut_at` lleva la hora y no solo la fecha. Guardando
el corte completo en `figures`, ninguna consulta puede mezclar dos: la fila *es*
el corte.

Eso importa porque los dos bloques de la tarjeta salen de filas distintas. El
total nacional viene del corte más reciente; el desglose por departamento, del
más reciente que lo traiga, que no es el mismo — el balance del 15 de agosto no
publicó desglose y el del 13 sí. **No se suman ni se comparan entre sí**: entre
esos dos cortes el Chocó pasó de 14 muertos a 13, porque la UNGRD corrigió hacia
abajo. Cada bloque se pinta con su propia fecha a la vista y ahí termina.

No hay columna que diga de qué tipo es un corte: cada uno trae las llaves que
publicó y las que no, no están. Las llaves son ids del catálogo de
`src/scripts/stats.ts`; una llave que el catálogo no conoce se ignora al leer, y
una cifra nueva es una entrada allá más la llave acá, sin migración.

**Fuente única: la UNGRD.** Las gobernaciones publican sus propias cuentas y no
cuadran con las de la UNGRD —el Valle contaba cerca de 200 muertos propios contra
los 148 que le asignó la UNGRD el 13 de agosto, y el Chocó reclamaba 43.000
damnificados contra 115.461 personas afectadas en todo el país—. No son erratas
sino metodologías distintas, y mezclarlas sería inventar una consistencia que
nadie publicó. **Esto vale solo para esta tabla**: los `municipio` siguen citando
prensa y gobernaciones en sus `notes`, porque la UNGRD no publica nada por
municipio y quitarles la cifra los dejaría con una lista de insumos sin razón.

Agregar el balance de hoy es una fila más:

```sql
insert into public.stats (id, source, source_url, cut_at, figures)
values (
  'ungrd-2026-08-16-0630', 'UNGRD', 'https://…',
  '2026-08-16T06:30:00-05:00',
  jsonb_build_object(
    'fallecidos', 000, 'heridos', 000, 'desaparecidos', 000, 'rescatados', 000,
    'familias_afectadas', 000, 'personas_afectadas', 000,
    'viviendas_destruidas', 000, 'viviendas_averiadas', 000,
    'departamentos', 00, 'municipios', 000
  )
);
```

El id lleva la fecha y la hora del corte porque hay más de uno al día. La página
lee los diez cortes más nuevos y se queda con el que corresponde a cada bloque,
así que publicar uno nuevo no pide borrar el anterior: el historial se queda y no
estorba.

Qué hay hoy, y qué está a punto de caerse del borde de los diez:

```sql
select id, cut_at, jsonb_pretty(figures) from public.stats order by cut_at desc;
```
