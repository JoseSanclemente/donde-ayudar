## Development

When starting the dev server, use background mode:

```
astro dev --background
```

Manage the background server with `astro dev stop`, `astro dev status`, and `astro dev logs`.

## Data ownership

Two kinds of data, and they must not mix:

- **Reportes** — anyone can create one from the form. They live in Supabase
  (`supabase/schema.sql`, client in `src/scripts/store.ts`) and are public: everyone sees
  every report, in realtime. Each visitor gets an anonymous Supabase session, and RLS lets
  a person delete only their own reports. Marking a resource as covered is communal and
  goes through the `set_resource_covered` RPC, which touches no other column. The site
  stays static — the browser talks to Supabase directly with the anon key.
- **Puntos de donación** — curated. YAML files in `src/content/centros/`, validated at
  build time by `src/content.config.ts`. Two kinds, split by a `tipo` discriminator:
  `acopio` (collection centers, carry `recibe`) and `sangre` (blood banks, no `recibe`).
  Repo write access is the only "admin privilege" in this project; the site is static, so
  a visitor has no way to write one. Read `src/content/centros/README.md` before adding
  or changing one.

## Documentation

Full documentation: https://docs.astro.build

Consult these guides before working on related tasks:

- [Adding pages, dynamic routes, or middleware](https://docs.astro.build/en/guides/routing/)
- [Working with Astro components](https://docs.astro.build/en/basics/astro-components/)
- [Using React, Vue, Svelte, or other framework components](https://docs.astro.build/en/guides/framework-components/)
- [Adding or managing content](https://docs.astro.build/en/guides/content-collections/)
- [Adding styles or using Tailwind](https://docs.astro.build/en/guides/styling/)
- [Supporting multiple languages](https://docs.astro.build/en/guides/internationalization/)
