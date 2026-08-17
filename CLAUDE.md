# Project Guidelines & Architecture

## Language & Development

- **Language**: Write code, comments (keep them short and concise), identifiers, commit messages, and
  documentation exclusively in English. Delete any Spanish comments.
- **Dev Server**: Run in background mode using:

  ```bash
  astro dev --background
  ```

  Manage via `astro dev stop`, `astro dev status`, and `astro dev logs`.

- **Typechecking**: Run `pnpm check` before committing, as Astro builds do not
  typecheck.

## Security Headers

The CSP requires the Supabase host name. To prevent desync,
`scripts/headers.mjs` (an Astro integration) dynamically generates
`dist/_headers` on `astro:build:done` using the `PUBLIC_SUPABASE_URL`
bundle variable. Missing variables throw an error to block publishing
without a CSP.

## Data Ownership & Tables

### 1. Communal Data (`reports`, `updates`, `offers`)

- **Access**: Public and realtime via anonymous Supabase sessions.
- **RLS Policies**: Anyone inserts; authors can only delete their own.
- **Communal Actions**: Modifying records relies strictly on specific RPCs
  (`set_resource_covered`, `assign_offer`).

### 2. Volunteers (`volunteers`)

- **Access**: Same RLS as communal data, but lacks communal RPCs and update
  policies.
- **Constraints**: A `CHECK` constraint requires either `contact_phone` or
  `contact_instagram`.
- **Schema Details**: `kind` (the trade) is a column strictly declared in
  `src/scripts/volunteers.ts`. Adding trades or reclassifying rows requires
  maintainer SQL.

### 3. Found Pets (`pets`)

- **Writers**: The browser never writes. Written by maintainers (SQL or
  `scripts/seed-pets.mjs`) or the `whatsapp-pets` Supabase Edge Function.
- **Constraints**: `photo_path` is mandatory; `contact_phone` or
  `contact_username` is required via a `CHECK` constraint.
- **Storage**: Rows only store the object key. The client fetches two
  transformed URLs: a 400x400 cover and an 800x800 contain.
- **Bot Workflow**: The Edge function handles a 3/4-step intake
  (`media ingestion` -> `kind` -> `sex` -> `consent`) managed via
  `pet_intakes` and `pet_senders`.

### 4. Donation Points (`centers`)

- **Types**: `acopio`, `albergue`, `sangre`, `healthcare`.
- **Origins & Insert Logic**:
  - `curado` points are added by maintainers (SQL).
  - `comunidad` points are added via the public form.
  - The strict insert policy only allows creating `comunidad` + `acopio`
    points.
- **Lifecycle**: Zero update policy. A communal `confirm_center` revokes 24-hour
  client-side expiries by touching `updated_at`.

## Client Layout Architecture

Imports must flow downward only:

```text
Pages -> Features -> Data -> Domain Modules -> UI Helpers
```

- **Pages** (`app.ts`, `pets.ts`): Single entry points per page. Handles boot
  logic, store initialization, and URL param parsing.
- **Features** (`features/`): Isolated UI components with `init...()` methods.
  Subscribes to stores; strictly forbidden from calling Supabase directly.
- **Data** (`data/`): Supabase integration layer. One store per table (e.g.,
  `reports.ts`, `centers.ts`), merged into a single realtime channel via
  `live.ts`. Includes `session.ts` and `sync.ts`.
- **Domain Modules** (Root `src/scripts/`): Framework-agnostic logic.
  - `map.ts` & `cluster.ts`: Leaflet rendering and marker groupings.
  - `address.ts`, `grid.ts`, `geocode.ts`: Colombian address parsing and
    fallback geocoding.
  - **Catalogs** (`resources.ts`, `pets-filter.ts`): Strict definitions of
    categories, chips, and verbatim Tailwind CSS classes.
  - `share-card.ts`: Client-side 1080x1920 PNG generation via Canvas for
    sharing.
- **UI Helpers** (`ui/`): Stateless DOM builders (`select`, `chip-group`,
  `breakpoint`) with zero domain knowledge or store access.

## Documentation References

See the official [Astro Docs](https://docs.astro.build) for guides on:

- [Routing](https://docs.astro.build/en/guides/routing/)
- [Components](https://docs.astro.build/en/basics/astro-components/)
- [Framework Components](https://docs.astro.build/en/guides/framework-components/)
- [Content Collections](https://docs.astro.build/en/guides/content-collections/)
- [Styling](https://docs.astro.build/en/guides/styling/)
- [Internationalization](https://docs.astro.build/en/guides/internationalization/)
