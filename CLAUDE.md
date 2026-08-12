## Language

Write in **English**: conversation, code, identifiers, comments, commit messages and
documentation. There is no exception for "small" comments.

Write in **Spanish** anything a visitor reads on screen: UI strings, the YAML content in
`src/content/centros/`, error and toast messages. The site serves Cali.

Existing Spanish comments stay as they are. Rewrite one only when the change makes it
wrong — no drive-by translation passes.

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
- **Puntos de donación** — curated, and the one table nobody can write from the browser.
  They live in Supabase too (`centros`), but with a single `select` policy and no insert,
  update or delete policy, so RLS denies all three. A maintainer edits them in the
  dashboard's table editor, which runs as `service_role`; dashboard and repo access are
  the only "admin privilege" in this project. Three kinds, split by a `tipo`
  discriminator: `acopio` (collection centers) and `albergue` (shelters) both carry
  `recibe` and can be paused with `recibiendo: false`; `sangre` (blood banks) carries
  neither — the `centros_recibe_por_tipo` check enforces it. Read `supabase/README.md`
  before adding or changing one; the category ids in `centros_recibe_ids` are the only
  copy of the `resources.ts` catalog outside the repo and have to be kept in sync by hand.

## Client layout

`src/scripts/` is split into layers, and imports only ever flow downward — never back up:

- **`app.ts`** — boot only: it calls each `init…()`, `initData()`, and the geo index
  loaders (`loadAddresses`, `loadStreets`).
- **`features/`** — one UI piece per file, each with its `init…()`: `alert-banner`,
  `centros-layer`, `marker-sheet`, `offers-panel`, `report-form`, `report-list`,
  `updates-feed`. They subscribe to the stores; they never call Supabase directly.
- **`data/`** — everything that talks to Supabase. One store per table (`reports.ts`,
  `updates.ts`, `offers.ts`, `centros.ts` — this last one read-only, no write path at
  all), each with its `emitter.ts` to announce changes and its
  `bindTable()` in `live.ts`, which merges every table into a single realtime channel.
  `boot.ts` runs once: anonymous session, initial load, and only then the channel.
  `session.ts` holds the current user id and `isMine()`, mirroring the RLS delete policy.
  `errors.ts` is the error bus the toast consumes.
- **Domain modules at the root of `src/scripts/`** — no Supabase, no DOM wiring:
  - `map.ts` — the Leaflet map, its markers and popups.
  - `cluster.ts` — merges nearby reports into groups.
  - `centros.ts` — the shape of a curated point: types and the `recibeInsumos()`
    narrowing. Reading them is `data/centros.ts`, drawing them is `map.ts`.
  - `resources.ts` / `status.ts` — the catalogs (resource categories and chips, point
    statuses). Tailwind classes are spelled out literally here: the scanner reads these
    files as plain text, so an interpolated class name never gets compiled.
  - `address.ts`, `grid.ts`, `geo-index.ts`, `geocode.ts` — the Colombian address
    pipeline: parse the nomenclature, compute the point off the street grid, read the
    prebuilt indexes from `public/geo/`, and resolve through the four fallback levels.
  - `sheet.ts` — the mobile bottom sheet (`display: contents` at >=1024px, so desktop is
    untouched).
  - `supabase.ts` — the client; `null` when the env vars are missing.
- **`ui/`** — stateless helpers with no domain knowledge (`dom`, `html`, `chips`,
  `contact`, `time`, `toast`, `breakpoint`). They know neither the stores nor the features.

When adding something, respect the layer — a feature that queries Supabase on its own, or
a `ui/` helper that imports a store, breaks the scheme.

## Documentation

Full documentation: https://docs.astro.build

Consult these guides before working on related tasks:

- [Adding pages, dynamic routes, or middleware](https://docs.astro.build/en/guides/routing/)
- [Working with Astro components](https://docs.astro.build/en/basics/astro-components/)
- [Using React, Vue, Svelte, or other framework components](https://docs.astro.build/en/guides/framework-components/)
- [Adding or managing content](https://docs.astro.build/en/guides/content-collections/)
- [Adding styles or using Tailwind](https://docs.astro.build/en/guides/styling/)
- [Supporting multiple languages](https://docs.astro.build/en/guides/internationalization/)
