/**
 * Identidad del sitio en un solo lugar.
 *
 * El nombre y la descripción viajan a varios sitios a la vez — `<title>`, la meta
 * description, Open Graph, la Twitter card, el manifest y el `<h1>` — y antes
 * estaban copiados a mano en cada uno. Acá se escriben una vez.
 *
 * `astro.config.mjs` repite `SITE_URL` como literal a propósito: el config se
 * evalúa fuera del grafo de módulos de `src/` y no puede importar de acá. Si
 * cambia el dominio, hay que tocar los dos.
 */

/** Origen de producción, sin barra final: las URLs absolutas se arman con `new URL(path, Astro.site)`. */
export const SITE_URL = "https://donde-ayudar.netlify.app";

export const SITE_NAME = "¿Dónde puedo ayudar?";

export const SITE_TITLE = "¿Dónde puedo ayudar? — Zonas afectadas por el sismo";

export const SITE_DESCRIPTION =
  "Mapa colaborativo de edificios afectados por el sismo en Colombia, los recursos que necesitan y los puntos donde donar.";

/** Ruta pública de la imagen social. La genera `npm run og` (ver `scripts/build-og.mjs`). */
export const OG_IMAGE = "/og.png";

export const OG_IMAGE_ALT =
  "¿Dónde puedo ayudar? — mapa colaborativo de edificios afectados por el sismo y puntos de donación.";
