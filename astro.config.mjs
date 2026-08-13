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
      // Leaflet y supabase-js sí hacen falta en el arranque —el mapa y los datos
      // son la primera pantalla—, así que el chunk de entrada no baja del aviso
      // por defecto de 500 kB. Lo que no hacía falta ya salió por `import()`: el
      // dibujante de la tarjeta para compartir y el geocoder, que solo existen
      // cuando alguien toca un botón o abre un formulario. El umbral queda
      // arriba para que volver a cruzarlo signifique algo: que entró una
      // dependencia nueva y grande en el camino crítico.
      chunkSizeWarningLimit: 600,
    },
  },
});
