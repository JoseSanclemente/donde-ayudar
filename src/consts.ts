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

/** El encabezado de `/mascotas`, que es su propia pregunta y no la del mapa. */
export const PETS_NAME = "¿Dónde está mi mascota?";

export const PETS_TITLE = "¿Dónde está mi mascota? — Mascotas encontradas";

export const PETS_DESCRIPTION =
  "Fotos de mascotas encontradas en la calle después del sismo, con el teléfono de quien las tiene.";

/** La página de privacidad, exigida por Meta para publicar la app de WhatsApp. */
export const PRIVACY_NAME = "Privacidad";

export const PRIVACY_TITLE = "Privacidad — ¿Dónde puedo ayudar?";

export const PRIVACY_DESCRIPTION =
  "Qué se publica en este sitio, quién lo ve y cómo borrarlo.";

export const SITE_DESCRIPTION =
  "Mapa colaborativo de edificios afectados por el sismo en Colombia, los recursos que necesitan y los puntos donde donar.";

/** Ruta pública de la imagen social. La genera `npm run og` (ver `scripts/build-og.mjs`). */
export const OG_IMAGE = "/og.png";

export const OG_IMAGE_ALT =
  "¿Dónde puedo ayudar? — mapa colaborativo de edificios afectados por el sismo y puntos de donación.";
