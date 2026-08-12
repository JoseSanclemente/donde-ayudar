# Dónde ayudar Cali

Mapa colaborativo de los edificios afectados por el sismo en Cali, los recursos que
necesitan, y los puntos donde donar.

Es un sitio estático de una sola ruta: un mapa de Cali (Leaflet) con dos capas de datos
que nunca se mezclan — los **reportes** que levanta cualquier visitante y los **puntos de
donación** curados por el equipo.

## Dos tipos de datos

**Reportes.** Cualquiera los crea desde el formulario. Viven en Supabase
(`supabase/schema.sql`, cliente en `src/scripts/data/`) y son públicos: todo el mundo
ve todos los reportes, en tiempo real. Cada visitante recibe una sesión anónima de
Supabase, y las policies de RLS dejan que cada quien borre solo los suyos. Marcar un
recurso como cubierto es comunal y pasa por el RPC `set_resource_covered`, que no toca
ninguna otra columna. El sitio sigue siendo estático: el navegador habla directo con
Supabase usando la anon key.

**Puntos de donación.** Curados. Viven en la tabla `centros` de Supabase, que es la única
de solo lectura: tiene una policy de `select` y ninguna de `insert`, `update` ni `delete`,
así que RLS se las niega a todo el mundo. Hay tres clases, separadas por el discriminador
`tipo`: `acopio` (centros de acopio) y `albergue` (albergues) llevan `recibe` y se pueden
pausar con `recibiendo: false`; `sangre` (bancos de sangre) no lleva ninguno de los dos.

Un visitante no tiene forma de escribir uno: se editan en el dashboard de Supabase
(**Table Editor → centros**), que corre como `service_role` y se salta RLS. Tener acceso
al dashboard —o al repositorio— es el único "permiso de administrador" del proyecto. Para
agregar o corregir un punto, lee primero [`supabase/README.md`](supabase/README.md). El
cambio sale al aire de inmediato, sin deploy.

## Stack

Astro 7 en modo estático (sin adaptador ni SSR), Tailwind 4, Leaflet con teselas de
CARTO, GSAP y `@supabase/supabase-js`. Requiere Node >= 22.12 y pnpm. El build sale a
`dist/` y se despliega en cualquier host estático.

## Puesta en marcha

```sh
pnpm install
cp .env.example .env   # y llenar con las llaves del proyecto de Supabase
pnpm dev
```

Las dos variables (`PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_ANON_KEY`) salen de
Project Settings → API. El prefijo `PUBLIC_` es lo que hace que Astro las inyecte en el
bundle del navegador, que es donde se usan; ambas son públicas por diseño y lo que
protege los datos es RLS, no el secreto de la llave. La `service_role` no va acá nunca.

Sin las variables el sitio igual levanta, pero queda vacío: el mapa de Cali se dibuja y
todo lo demás —reportes y puntos de donación— muestra un error en vez de cargar
(`src/scripts/supabase.ts`).

Para montar el backend desde cero: correr `supabase/schema.sql` tal cual en el SQL Editor
del proyecto y habilitar Authentication → Sign In / Providers → **Anonymous sign-ins**
(sin eso nadie puede insertar).

## 🧞 Comandos

Todos se corren desde la raíz del proyecto:

| Comando        | Acción                                                       |
| :------------- | :------------------------------------------------------------ |
| `pnpm install` | Instala las dependencias                                       |
| `pnpm dev`     | Servidor local en `localhost:4321`                             |
| `pnpm build`   | Construye a `./dist/`                                          |
| `pnpm preview` | Previsualiza el build antes de desplegar                       |
| `pnpm astro …` | CLI de Astro (`astro add`, `astro check`, `astro -- --help`)   |

## 📍 Geocodificación de direcciones

OpenStreetMap tiene numerados 1.086 edificios en toda Cali (~0,1%), así que
buscar la dirección casi nunca funciona. Lo que sí tiene es el callejero
completo — y la nomenclatura colombiana ya dice dónde cae el punto:

> `Calle 8B # 45-17` = sobre la Calle 8B, en el cruce con la Carrera 45, a 17 m
> de esa esquina.

`src/scripts/address.ts` interpreta la dirección y `src/scripts/grid.ts` calcula
el punto sobre la malla vial. Medido contra las direcciones que OSM sí tiene
numeradas: mediana 24 m, 65% por debajo de 50 m, 88% por debajo de 200 m.

Cuando eso no alcanza, `src/scripts/geocode.ts` baja por cuatro niveles: índice local de
direcciones → cálculo sobre la malla → Nominatim → clic manual en el mapa. Los dos
primeros funcionan sin red.

| Comando          | Acción                                                            |
| :--------------- | :----------------------------------------------------------------- |
| `pnpm geo:build` | Regenera `public/geo/` desde OpenStreetMap (~2 min, necesita red)   |
| `pnpm geo:eval`  | Mide la precisión del geocodificador y falla si baja del listón     |
| `pnpm og`        | Regenera `public/og.png` y los iconos del manifest                  |

`geo:build` consulta la API de Overpass y **no** corre como parte de `pnpm build`: los
índices de `public/geo/` están versionados en el repositorio, así que el sitio funciona
recién clonado.

`og` tampoco corre en el build, por otra razón: rasteriza texto con las fuentes del
sistema, y las del contenedor de Netlify no son las de un escritorio. Se ejecuta a mano,
se revisa el PNG con los ojos y el resultado se commitea.

## Despliegue

En producción: **https://donde-ayudar.netlify.app**

El dominio está escrito en tres lugares y los tres tienen que coincidir:
`src/consts.ts` (`SITE_URL`), `astro.config.mjs` (`site`, que es lo que hace absolutas
las URLs de Open Graph) y `public/robots.txt` + `public/sitemap.xml`.

`netlify.toml` deja listo el despliegue en Netlify: `pnpm build` → `dist`, Node 22.12 y
las cabeceras de seguridad (CSP que solo permite Supabase, las teselas de CARTO y
Nominatim). Las dos variables `PUBLIC_*` hay que configurarlas en Site settings →
Environment variables: tienen que existir en build time porque Astro las inyecta en el
bundle.

Si el proyecto de Supabase cambia, actualizar también el dominio en la `connect-src` de
la CSP.

## Atribución

Los índices de `public/geo/` derivan de OpenStreetMap y se distribuyen bajo
[ODbL](https://www.openstreetmap.org/copyright). Las teselas del mapa son de
[CARTO](https://carto.com/attributions).

## Licencia

Código bajo licencia MIT — ver [LICENSE](LICENSE).
