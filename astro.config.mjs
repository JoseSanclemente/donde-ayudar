// @ts-check
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';

import { headers } from './scripts/headers.mjs';

// La CSP necesita el host de Supabase, y el config corre antes de que exista
// `import.meta.env`. En Netlify la variable ya está en el entorno; en local vive
// en el `.env`, que Node sabe leer solo. Falta el archivo en CI y eso no es un
// error: lo que importa es que la variable exista, y de eso se queja el plugin.
try {
  process.loadEnvFile('.env');
} catch {
  // No hay `.env` — se sigue con lo que traiga el entorno.
}

const { PUBLIC_SUPABASE_URL } = process.env;

// https://astro.build/config
export default defineConfig({
  // Sin `site`, `Astro.site` es undefined y las URLs de Open Graph salen
  // relativas — que los crawlers ignoran. Duplica `SITE_URL` de `src/consts.ts`
  // porque el config no puede importar del grafo de módulos de `src/`.
  site: 'https://donde-ayudar.netlify.app',

  integrations: [headers(PUBLIC_SUPABASE_URL)],

  vite: {
    plugins: [tailwindcss()],

    build: {
      // El aviso por defecto son 500 kB y este bundle no baja de ahí: Leaflet,
      // supabase-js y GSAP son 123 kB comprimidos de los 149 kB del total, y los
      // tres hacen falta en el arranque —el mapa, los datos y el sheet—. Partir
      // el chunk no quitaría un solo byte de la primera pantalla. El umbral se
      // sube para que el aviso vuelva a significar algo: que entró una
      // dependencia nueva y grande.
      chunkSizeWarningLimit: 600,
    },
  },
});
