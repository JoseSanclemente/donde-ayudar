## Language

Write in **English**: conversation, code, identifiers, comments, commit messages and
documentation. There is no exception for "small" comments.

DELETE ANY COMMENT IN SPANISH.

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
  `volunteers` is the same shape with nothing communal at all — no RPC and
  no update policy, a signup stands or is withdrawn. Its one particularity is the contact:
  `contact_phone` and `contact_instagram` are each optional, and a CHECK demands at least
  one of the two, because whoever offers to listen does not always hand out their number.
  One table serves every panel where somebody offers their own time, split by a `kind`
  discriminator — `salud_mental` and `juridica` — because they are the same signup with
  different copy: one set of policies, one throttle, one realtime binding. The panels are
  declared in `src/scripts/volunteers.ts` and nowhere else; adding one is an entry there
  plus its value in the CHECK.
- **Mascotas encontradas** — `pets`, the smallest table and the only one with a file behind
  it: a `kind` (`dog`, `cat`, `other`), an optional `sex` (`male`, `female` — «no sé» is
  `null`, and so is every row published before the column), a mandatory `contact_phone`
  and `photo_path`. The
  photo is not in the row — it goes to the public `pets` bucket in Storage and the row keeps
  its object key, because the bytes in a column would ride along in every realtime payload.
  The page never asks for that object: `data/pets.ts` derives two urls off the Storage
  transform endpoint from the one key — a 400×400 `cover` for the grid card and an 800×800
  `contain` for the sheet — so the card costs ~20 KB instead of the third of a megabyte
  a WhatsApp photo weighs, and the big one is only paid by whoever taps. Both dimensions
  always: `width` alone keeps no aspect ratio.
  Same policies as `volunteers` plus two on `storage.objects` that mirror them. The write
  order is fixed in `data/pets.ts`: photo first, row second, and the object is removed if
  the insert fails. `/mascotas` only reads.
  The table has a second writer, and it is the only server-side code in the project:
  `supabase/functions/whatsapp-pets`, an Edge Function behind the city's WhatsApp number.
  It runs on Supabase and not on Netlify, so the site stays static — no adapter, no
  `netlify.toml` change, nothing in `dist` — and the browser never calls it. The
  conversation is three steps because a photo says neither what animal it is nor whether
  it is a male or a female, and a message carries three buttons at most: the photo arrives
  and a `pet_intakes` row keeps the Graph media id while the kind buttons go back; the kind
  tap is saved on that row and the sex buttons go back; the sex tap is the one that
  downloads, uploads and publishes. That order is why there are no orphan objects to sweep
  — a photo nobody finishes classifying never reaches the bucket, and the rows expire in
  the function itself. The intake also keeps `wa_kind_message_id`, because the middle step
  deletes nothing: it is what tells a Meta resend from somebody correcting the kind. `pet_intakes` has RLS
  with no policies at all, which is what makes it invisible to everyone but
  `service_role`. Those rows carry the bot user in `user_id` and their objects have no
  `owner`, so nothing removes them from a browser; taking one down is the maintainer SQL
  in `supabase/README.md`, which is also where the secrets are listed.
- **Puntos de donación** — the table with the narrowest write surface, in Supabase too
  (`centers`). Four kinds, split by a `type` discriminator: `acopio` (collection centers),
  `albergue` (shelters), `sangre` (blood banks) and `healthcare` (where the injured are
  treated). All four carry `donations`, and for all four it is optional. A second
  discriminator, `origin`, says who published it: a `curado` point is written by a
  maintainer with SQL, which runs as `service_role` (dashboard and repo access are the
  only "admin privilege" in this project); a `comunidad` point is registered by anyone
  from the form and publishes immediately. The insert policy is the whole write surface
  and pins all of `origin = 'comunidad'`, `type = 'acopio'`, `is_active` and `user_id =
auth.uid()`, so the other three types cannot be created from the browser. Deleting is
  the author's own point only, and **there is no update policy at all** — nothing edits a
  point once published. Two flags carry the state and they are not the same: `is_active:
false` greys the marker out, `accepting_donations: false` only writes a line in the
  popup, and retiring a point for good is deleting the row. The one communal bit is
  `confirm_center`, which touches only `updated_at`: a community `acopio` nobody has
  touched in `EXPIRY_HOURS` (24) is drawn grey and anyone can revive it from the popup.
  Expiry is computed in the browser, so a maintainer never has to sweep the table and
  there is no scheduled job. Nothing else expires — a curated point has an owner, and a
  shelter has people sleeping in it.
  The map keeps the same square for both origins and only lightens the colour; the popup
  labels both («Creado por la alcaldía» / «Creado por la comunidad»). `donations` names
  individual supplies from the `resources.ts` catalog — the same strings a report asks
  for, so a need and a point can be compared item by item — and is validated by length
  only, like `reports.resources`. Rows saved before that carry category ids instead;
  `data/centers.ts` expands them on read. Read `supabase/README.md` before adding or
  changing a point.

## Client layout

`src/scripts/` is split into layers, and imports only ever flow downward — never back up:

- **One entry per page**, declared by the page itself and not by `Base.astro` — `app.ts`
  for the map (`index.astro`), `pets.ts` for `/mascotas`. A single import in the layout
  charged each page for the other's bundle, and `app.ts` boots Leaflet, the address
  pipeline and the six stores, none of which the pets page has any use for.
  - **`app.ts`** — boot only: it calls each `init…()`, `initData()`, and `loadAddresses()`.
    The street grid is not asked for here: `public/geo/streets.json` is two megabytes, so
    `location-picker` starts it on the first focus of an address field and `app.ts` only
    warms it from an idle callback, for the visitor who never opens a form.
  - **`pets.ts`** — the same thing for `/mascotas`, and much shorter: the sheet, the grid,
    the ticker and `initPetsData()`. It reaches `data/boot-pets.ts` and never `data/boot.ts`,
    because that one imports every store to call its `load…()` and an import is what pulls
    a module into the bundle.
- **`features/`** — one UI piece per file, each with its `init…()`: `alert-banner`,
  `center-form`, `centers-layer`, `header-offset`, `location-picker`, `marker-actions`,
  `marker-sheet`, `offers-panel`, `report-form`, `report-history`, `report-list`, `report-tabs`,
  `resource-picker`, `share`, `sync-badge`, `updates-feed`, `user-location`,
  `volunteer-panel`, `pets-grid`. They
  subscribe to the stores; they never call Supabase directly. `marker-actions` is the odd
  one: the marker detail is HTML built by `map.ts`, which cannot touch the stores, so the
  wiring for its controls is delegated on `document` from there. `location-picker`,
  `resource-picker` and `volunteer-panel` are the exception to "one
  UI piece": they are factories, and the two forms — a need and a collection point — each
  create one of each over their own copy of `LocationField.astro` and
  `ResourcePicker.astro`, keyed by an id prefix; `volunteer-panel` does the same over
  `VolunteerPanel.astro`, one per entry of `scripts/volunteers.ts`. The
  draft pin and the click-to-pick mode are single, so `report-tabs` hands them over
  between the two with `suspend()`/`resume()`.
- **`data/`** — everything that talks to Supabase. One store per table (`reports.ts`,
  `updates.ts`, `offers.ts`, `volunteers.ts` — this one shared by every panel, handed out
  per `kind` by `volunteerStore()` —, `centers.ts` — this last one insert-only, and only for a
  community `acopio`, plus the one communal bit, `confirmCenter()`), each with its
  `emitter.ts` to announce changes and its
  `bindTable()` in `live.ts`, which merges every table into a single realtime channel.
  `boot.ts` runs once: anonymous session, initial load, and only then the channel.
  `boot-pets.ts` is the same three steps for `/mascotas`, minus the session — that page
  only reads and the SELECT policy is `to anon` — and with its own reread, because
  `sync.ts` imports the six stores.
  `session.ts` holds the current user id and `isMine()`, mirroring the RLS delete policy.
  `errors.ts` is the error bus the toast consumes. `sync.ts` is the freshness of the data:
  realtime never resends what happened while the socket was down, so it re-reads every
  table on reconnect and when the tab comes back, and publishes the state that
  `features/sync-badge.ts` shows in the header.
- **Domain modules at the root of `src/scripts/`** — no Supabase, no DOM wiring:
  - `map.ts` — the Leaflet map, its markers and popups.
  - `cluster.ts` — merges nearby reports into groups. `groupReports` is the one
    door every live consumer walks through, and it drops what `isRetired` says is
    gone. `groupZones` is the same grouping without that filter, for the one
    caller that wants the points that fell off the map: `features/report-history`,
    the folded list of already-reported places above the need form. Nothing
    deletes a report, so the address and the coordinates of a retired point are
    still in the store — the whole card is one button and it fills the location
    half of the form and nothing else, because what changed is exactly the
    resources. A place already off the map says so on its card: reposting an old
    report and confirming a live one are not the same act.
  - `centers.ts` — the shape of a donation point: the `Center` type, `isCommunity()` and
    `isExpired()`. Reading and writing them is `data/centers.ts`, drawing them is
    `map.ts`.
  - `resources.ts` / `status.ts` — the catalogs (resource categories and chips, point
    statuses). Tailwind classes are spelled out literally here: the scanner reads these
    files as plain text, so an interpolated class name never gets compiled.
  - `volunteers.ts` — the catalog of volunteer panels: one entry per `kind`, with its id
    prefix, its sheet tab, its icon path and its copy. `index.astro` loops over it to
    build both the tab buttons and the cards, and `features/volunteer-panel.ts` loops
    over it to wire them, so a new panel is declared once.
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
  - `pet-sheet.ts` — the panel of `/mascotas`, the visual twin of `sheet.ts` with none of
    what ties that one to the map: no tabs, no `peek`, no breakpoint branch, no import of
    `map.ts`. It is a panel at every width — that page has no sidebar to become — and it
    only knows how to swap its body and slide.
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
- **`ui/`** — stateless helpers with no domain knowledge (`accordion`, `breakpoint`,
  `chips`, `contact`, `dom`, `html`, `pick-hint`, `select`, `status-select`, `time`,
  `toast`). They know neither the stores nor the features. `accordion` is the fold of the
  three sidebar cards: it takes an id prefix, opens closed and flips `data-collapsed`,
  which the one CSS rule for `[data-panel-card]` reads behind the `lg` media query. `select` is the one select of the site in its two
  variants — `field`, the white form control, and `chip`, the status pill painted with the
  colour of the state — as class constants plus the caret, so the five places that build a
  select (two as HTML strings, two as elements, two as markup) share one look;
  `Select.astro` is the `field` variant for the two written as markup, and the `option`
  rule in `global.css` normalises the open menu, which otherwise inherits the chip's
  colour. `status-select` sits on top of it: the status `<select>` as a string, for the
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
