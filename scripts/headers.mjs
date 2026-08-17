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

    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",

    `img-src 'self' data: blob: ${rest} https://*.basemaps.cartocdn.com`,

    `connect-src 'self' ${rest} ${realtime} https://nominatim.openstreetmap.org`,
  ].join("; ");
}

function headersFile(supabaseUrl) {
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

# El nombre de cada archivo de \`/_astro/\` lleva el hash de su contenido: cambiar
# el bundle cambia la URL, así que la vieja no puede quedar obsoleta y no hay
# nada que revalidar. Sin esta regla Netlify sirve todo con
# \`max-age=0, must-revalidate\` y cada visita paga una ida y vuelta por el JS, el
# CSS y las dos fuentes antes de poder usar lo que ya tenía en disco.
/_astro/*
  Cache-Control: public, max-age=31536000, immutable

# Los índices de \`/geo/\` no llevan hash —los nombra \`scripts/build-geo-index.mjs\`
# y los lee \`geo-index.ts\` por ruta fija—, así que no pueden ser inmutables: un
# día es el techo, y son datos que cambian con un rebuild, no entre visitas. Lo
# que se evita es que la malla vial vuelva a bajarse entera en cada visita que
# abre el formulario: son dos megas.
/geo/*
  Cache-Control: public, max-age=86400
`;
}

export function headers(supabaseUrl) {
  return {
    name: "headers",
    hooks: {
      "astro:build:done": async ({ dir, logger }) => {
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
