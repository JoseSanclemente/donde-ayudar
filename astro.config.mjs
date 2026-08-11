// @ts-check
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  // Sin `site`, `Astro.site` es undefined y las URLs de Open Graph salen
  // relativas — que los crawlers ignoran. Duplica `SITE_URL` de `src/consts.ts`
  // porque el config no puede importar del grafo de módulos de `src/`.
  site: 'https://donde-ayudar.netlify.app',

  vite: {
    plugins: [tailwindcss()]
  }
});