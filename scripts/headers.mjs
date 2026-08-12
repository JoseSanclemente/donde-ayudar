/**
 * Las cabeceras del sitio, como plugin de Astro: escribe `dist/_headers`, que es
 * el formato que Netlify lee del directorio publicado.
 *
 * Vivían en `netlify.toml`, con el host de Supabase escrito a mano dentro de la
 * CSP. Eran los mismos datos en dos sitios: cambiar de proyecto en Supabase
 * dejaba la CSP apuntando al viejo, y lo que se rompía no era el build sino el
 * realtime en producción — el navegador bloquea el WebSocket en silencio. Acá el
 * host sale de `PUBLIC_SUPABASE_URL`, la misma variable que se inyecta en el
 * bundle, así que las dos mitades no se pueden separar.
 */
import { mkdir, writeFile } from "node:fs/promises";

/** El WebSocket de realtime va al mismo host que el REST, en `wss:`. */
function supabaseOrigins(rawUrl) {
  const url = new URL(rawUrl);
  return [`https://${url.host}`, `wss://${url.host}`];
}

function csp(supabaseUrl) {
  const [rest, realtime] = supabaseOrigins(supabaseUrl);
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "script-src 'self'",
    // Leaflet y GSAP posicionan y animan escribiendo en `element.style`.
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    "img-src 'self' data: https://*.basemaps.cartocdn.com",
    // Los tres destinos que el sitio necesita y nada más: Supabase (REST y el
    // WebSocket de realtime), y Nominatim para buscar direcciones. Las teselas
    // de CARTO no entran acá: van por `img-src`.
    `connect-src 'self' ${rest} ${realtime} https://nominatim.openstreetmap.org`,
  ].join("; ");
}

function headersFile(supabaseUrl) {
  // Los comentarios van todos acá arriba, en la columna 0: dentro del bloque,
  // una línea más con sangría es lo mismo que una cabecera para el parser.
  return `# Generado por scripts/headers.mjs en cada build — no editar a mano.
#
# Referrer-Policy: Nominatim recibe cada dirección que alguien escribe; que no
# reciba además la ruta completa desde donde se buscó.
#
# Permissions-Policy: \`geolocation=(self)\` y no \`()\` — la lista vacía apaga la
# API para todo el mundo, incluido el propio documento, y el navegador ni
# siquiera pregunta: el mapa se queda en Cali para siempre. Las otras cuatro sí
# están apagadas del todo.
/*
  Content-Security-Policy: ${csp(supabaseUrl)}
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: geolocation=(self), camera=(), microphone=(), payment=(), usb=()
`;
}

/** `supabaseUrl` lo lee `astro.config.mjs` del entorno, con Vite. */
export function headers(supabaseUrl) {
  return {
    name: "headers",
    hooks: {
      "astro:build:done": async ({ dir, logger }) => {
        // Sin la variable no se puede escribir la CSP, y publicar sin CSP —o con
        // una que no deje hablar con la base— es peor que no publicar: falla acá,
        // donde se ve.
        if (!supabaseUrl) {
          throw new Error(
            "Falta PUBLIC_SUPABASE_URL: sin ella no se puede generar la CSP de dist/_headers.",
          );
        }

        const path = new URL("_headers", dir);
        await mkdir(new URL(".", path), { recursive: true });
        await writeFile(path, headersFile(supabaseUrl), "utf8");
        logger.info(`_headers escrito para ${new URL(supabaseUrl).host}`);
      },
    },
  };
}
