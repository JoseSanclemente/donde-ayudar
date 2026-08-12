## Language

Write in **English**: conversation, code, identifiers, comments, commit messages and
documentation. There is no exception for "small" comments.

Write in **Spanish** anything a visitor reads on screen: UI strings, the rows a maintainer
writes into `centros`, error and toast messages. The site serves Cali.

Existing Spanish comments stay as they are. Rewrite one only when the change makes it
wrong — no drive-by translation passes.

## Development

When starting the dev server, use background mode:

```
astro dev --background
```

Manage the background server with `astro dev stop`, `astro dev status`, and `astro dev logs`.

`pnpm check` runs `astro check` — types across `.astro` and `.ts` alike. Run it before a
commit; the build does not typecheck.

## Headers

The security headers are not in `netlify.toml`. The CSP has to name the Supabase host, and
written there it was the same fact in two places: switching projects left the CSP pointing
at the old one, and what broke was not the build but realtime in production — the browser
blocks the WebSocket in silence. `scripts/headers.mjs` is an Astro integration that writes
`dist/_headers` on `astro:build:done`, deriving the origins from `PUBLIC_SUPABASE_URL` —
the same variable that goes into the bundle. It throws when the variable is missing:
publishing with no CSP is worse than not publishing.

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
- **Puntos de donación** — the table with the narrowest write surface, in Supabase too
  (`centros`). Three kinds, split by a `tipo` discriminator: `acopio` (collection centers)
  and `albergue` (shelters) both carry `recibe` and can be paused with `recibiendo:
  false`; `sangre` (blood banks) carries neither — the `centros_recibe_por_tipo` check
  enforces it. A second discriminator, `origen`, says who published it: a `curado` point
  is edited by a maintainer in the dashboard's table editor, which runs as `service_role`
  (dashboard and repo access are the only "admin privilege" in this project); a
  `comunidad` point is registered by anyone from the form and publishes immediately. The
  insert policy is the whole write surface and pins all of `origen = 'comunidad'`, `tipo =
  'acopio'`, `activo` and `user_id = auth.uid()`, so a shelter, a blood bank or any
  curated point cannot be created from the browser. Deleting is the author's own point
  only, and **there is no update policy at all** — nothing edits a point once published.
  The map keeps the same square for both origins and only lightens the colour; the popup
  labels both («Creado por la alcaldía» / «Creado por la comunidad»). `recibe` names
  individual supplies from the `resources.ts` catalog — the same strings a report asks
  for, so a need and a point can be compared item by item — and is validated by length
  only, like `reports.resources`. Rows saved before that carry category ids instead;
  `data/centros.ts` expands them on read. Read `supabase/README.md` before adding or
  changing a point.

## Client layout

`src/scripts/` is split into layers, and imports only ever flow downward — never back up:

- **`app.ts`** — boot only: it calls each `init…()`, `initData()`, and `loadAddresses()`.
  The street grid is not asked for here: `public/geo/streets.json` is two megabytes, so
  `location-picker` starts it on the first focus of an address field and `app.ts` only
  warms it from an idle callback, for the visitor who never opens a form.
- **`features/`** — one UI piece per file, each with its `init…()`: `alert-banner`,
  `centro-form`, `centros-layer`, `header-offset`, `location-picker`, `marker-actions`,
  `marker-sheet`, `offers-panel`, `report-form`, `report-list`, `report-tabs`,
  `resource-picker`, `share`, `sync-badge`, `updates-feed`, `user-location`. They
  subscribe to the stores; they never call Supabase directly. `marker-actions` is the odd
  one: the marker detail is HTML built by `map.ts`, which cannot touch the stores, so the
  wiring for its controls is delegated on `document` from there. `location-picker` and
  `resource-picker` are the exception to "one
  UI piece": they are factories, and the two forms — a need and a collection point — each
  create one of each over their own copy of `LocationField.astro` and
  `ResourcePicker.astro`, keyed by an id prefix. The
  draft pin and the click-to-pick mode are single, so `report-tabs` hands them over
  between the two with `suspend()`/`resume()`.
- **`data/`** — everything that talks to Supabase. One store per table (`reports.ts`,
  `updates.ts`, `offers.ts`, `centros.ts` — this last one insert-only, and only for a
  community `acopio`), each with its `emitter.ts` to announce changes and its
  `bindTable()` in `live.ts`, which merges every table into a single realtime channel.
  `boot.ts` runs once: anonymous session, initial load, and only then the channel.
  `session.ts` holds the current user id and `isMine()`, mirroring the RLS delete policy.
  `errors.ts` is the error bus the toast consumes. `sync.ts` is the freshness of the data:
  realtime never resends what happened while the socket was down, so it re-reads every
  table on reconnect and when the tab comes back, and publishes the state that
  `features/sync-badge.ts` shows in the header.
- **Domain modules at the root of `src/scripts/`** — no Supabase, no DOM wiring:
  - `map.ts` — the Leaflet map, its markers and popups.
  - `cluster.ts` — merges nearby reports into groups.
  - `centros.ts` — the shape of a donation point: types and the `recibeInsumos()` /
    `esComunitario()` narrowings. Reading and writing them is `data/centros.ts`, drawing
    them is `map.ts`.
  - `resources.ts` / `status.ts` — the catalogs (resource categories and chips, point
    statuses). Tailwind classes are spelled out literally here: the scanner reads these
    files as plain text, so an interpolated class name never gets compiled.
  - `address.ts`, `grid.ts`, `geo-index.ts`, `geocode.ts` — the Colombian address
    pipeline: parse the nomenclature, compute the point off the street grid, read the
    prebuilt indexes from `public/geo/`, and resolve through the four fallback levels.
    The prebuilt indexes cover Cali and nothing else, and the nomenclature of every other
    Colombian city parses just as well — so resolving a Yumbo address against them does
    not fail, it returns a point in Cali. `namesAnotherCity()` in `address.ts` reads the
    tail the parser could not consume; when it names a municipality, `geocode()` skips the
    local levels. Nominatim is then asked twice — once suffixed «Cali, Valle del Cauca»
    with the Cali viewbox, once for the country with neither — and the first non-empty
    answer wins. The tail only chooses which goes first, so guessing wrong costs a round
    trip and never a pin in the wrong city. The second attempt is what a place written by
    name needs: «Lomitas, La Cumbre» leaves no tail to read and returns zero under the
    Cali suffix, though it is perfectly mapped.
  - `geolocation.ts` — where the visitor is: the browser permission, wrapped so it never
    fails outward, and the cached last position the map opens on. No address, no city
    name — only the coordinates the initial `setView` needs. The map is nobody's to move
    once a gesture, a geocoded suggestion or a draft pin has claimed the view. The «you
    are here» dot and the recenter button are drawn only from a live answer, never from
    the cache: centering on a weeks-old position is harmless, a dot claiming it is not.
  - `sheet.ts` — the mobile bottom sheet (`display: contents` at >=1024px, so desktop is
    untouched).
  - `share-card.ts` — the 1080×1920 PNG behind the share button — story format, full
    screen on a phone — drawn on a canvas: a CARTO tile crop of the point, then its name,
    address and chips. The card is measured before anything is drawn and the map crop
    takes whatever height is left over, down to a floor; chips shrink through a size
    ladder rather than being cut, because the list of what a point needs is the whole
    point of the image. Client-side because
    the site is static — there is no server to render an `og:image` on and no per-point
    URL to hand a crawler, so what travels is the file, not a link preview. It takes a
    `ShareCard` and returns a `Blob`; `map.ts` builds the descriptor while it builds the
    popup and keeps it in a registry (`getShareCard`), and `features/share.ts` hands the
    blob to `navigator.share`, or downloads it where sharing files is not supported. The
    chip colours are spelled out in hex here — the canvas twin of the Tailwind classes in
    `resources.ts`, and a new category has to be added to both.
  - `supabase.ts` — the client; `null` when the env vars are missing.
- **`ui/`** — stateless helpers with no domain knowledge (`breakpoint`, `chips`, `contact`,
  `dom`, `html`, `pick-hint`, `status-select`, `time`, `toast`). They know neither the
  stores nor the features. `status-select` is the status `<select>` as a string, for the
  two places built as HTML — the map popup and the mobile sheet; the list builds its own as
  an element. Whoever listens for the `change` is a feature.

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
