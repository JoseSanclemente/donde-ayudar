## Development

When starting the dev server, use background mode:

```
astro dev --background
```

Manage the background server with `astro dev stop`, `astro dev status`, and `astro dev logs`.

## Data ownership

Two kinds of data, and they must not mix:

- **Reportes** — anyone can create one from the form. They live in Supabase
  (`supabase/schema.sql`, client in `src/scripts/data/`) and are public: everyone sees
  every report, in realtime. Each visitor gets an anonymous Supabase session, and RLS lets
  a person delete only their own reports. Marking a resource as covered is communal and
  goes through the `set_resource_covered` RPC, which touches no other column. The site
  stays static — the browser talks to Supabase directly with the anon key. Same deal for
  `updates` (the city log) and `offers` (help someone has available): anyone inserts, only
  the author deletes, and the communal bit — assigning an offer to a point — goes through
  the `assign_offer` RPC, which touches only `report_id` and `assigned_at`.
- **Puntos de donación** — curated. YAML files in `src/content/centros/`, validated at
  build time by `src/content.config.ts`. Three kinds, split by a `tipo` discriminator:
  `acopio` (collection centers) and `albergue` (shelters) both carry `recibe` and can be
  paused with `recibiendo: false`; `sangre` (blood banks) carries neither.
  Repo write access is the only "admin privilege" in this project; the site is static, so
  a visitor has no way to write one. Read `src/content/centros/README.md` before adding
  or changing one.

## Client layout

`src/scripts/` está partido en tres capas, y la dirección de los imports es de arriba
hacia abajo — nunca al revés:

- **`data/`** — todo lo que habla con Supabase. Un store por tabla (`reports.ts`,
  `updates.ts`), cada uno con su `emitter.ts` para avisar cambios y su `bindTable()` en
  `live.ts`, que junta todas las tablas en un solo canal de realtime. `boot.ts` corre una
  vez: sesión anónima, carga inicial, y recién ahí abre el canal. `errors.ts` es el bus de
  errores que el toast consume.
- **`features/`** — una pieza de UI por archivo (`report-form`, `report-list`,
  `centros-panel`, `alert-banner`, `updates-feed`, `offers-panel`), cada una con su
  `init…()`. Se suscriben
  a los stores; no llaman a Supabase directo.
- **`ui/`** — helpers sin estado de dominio (`dom`, `html`, `chips`, `contact`, `time`,
  `toast`). No conocen ni los stores ni las features.

`app.ts` es solo el arranque: llama a cada `init…()` y a `initData()`. Al agregar algo,
respeta la capa — una feature que consulta Supabase por su cuenta, o un helper de `ui/`
que importa un store, rompe el esquema.

## Documentation

Full documentation: https://docs.astro.build

Consult these guides before working on related tasks:

- [Adding pages, dynamic routes, or middleware](https://docs.astro.build/en/guides/routing/)
- [Working with Astro components](https://docs.astro.build/en/basics/astro-components/)
- [Using React, Vue, Svelte, or other framework components](https://docs.astro.build/en/guides/framework-components/)
- [Adding or managing content](https://docs.astro.build/en/guides/content-collections/)
- [Adding styles or using Tailwind](https://docs.astro.build/en/guides/styling/)
- [Supporting multiple languages](https://docs.astro.build/en/guides/internationalization/)
