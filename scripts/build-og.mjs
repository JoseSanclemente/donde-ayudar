/**
 * Genera la imagen social (`public/og.png`) y los iconos PNG del manifest.
 *
 *   pnpm og
 *
 * No corre en cada build, a propósito. Rasterizar texto depende de las fuentes
 * instaladas en la máquina, y el contenedor de build de Netlify no tiene las
 * mismas que un escritorio: el título saldría corrido, con otra fuente o en
 * blanco, y nadie lo notaría hasta ver el enlace ya compartido en WhatsApp.
 * Se corre a mano, se mira el PNG, y el resultado se commitea a `public/`
 * — igual que `scripts/build-geo-index.mjs`.
 *
 * Si algún día esto tiene que correr en CI, hay que meter un .woff/.ttf al repo
 * y pasarlo por `font.fontFiles` en vez de depender de las fuentes del sistema.
 */
import { writeFile } from "node:fs/promises";
import { Resvg } from "@resvg/resvg-js";

const OUT_DIR = new URL("../public/", import.meta.url);

const RED = "#ef4444";
const RED_DARK = "#b91c1c";
const SLATE_900 = "#0f172a";
const SLATE_600 = "#475569";
const SLATE_400 = "#94a3b8";

// Duplicados de `src/consts.ts` a mano: este script es Node puro y no puede
// importar de un módulo TypeScript sin sumar un paso de compilación.
const SITE_NAME = "Dónde Ayudar Cali";
const DOMAIN = "donde-ayudar.netlify.app";

// Pila de fuentes, no una sola: la primera que exista gana. Sans-serif al final
// para que nunca caiga en la serif por defecto de resvg.
const FONTS = "Segoe UI, Inter, Helvetica Neue, Arial, sans-serif";

/**
 * El marcador de reporte del mapa (`.pulse-marker` en global.css, congelado en
 * `public/favicon.svg`): anillo tenue, aro rojo, punto sólido.
 */
function marker(cx, cy, scale) {
  return `
    <circle cx="${cx}" cy="${cy}" r="${54 * scale}" fill="${RED}" fill-opacity="0.16" />
    <circle cx="${cx}" cy="${cy}" r="${40 * scale}" fill="none" stroke="${RED}" stroke-width="${9 * scale}" />
    <circle cx="${cx}" cy="${cy}" r="${21 * scale}" fill="${RED}" />`;
}

const og = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#ffffff" />
  <rect width="1200" height="12" fill="${RED}" />
  ${marker(210, 315, 1.75)}
  <g font-family="${FONTS}">
    <text x="410" y="196" fill="${RED_DARK}" font-size="28" font-weight="700" letter-spacing="3">EMERGENCIA SISMO — CALI</text>
    <text x="410" y="290" fill="${SLATE_900}" font-size="78" font-weight="700">${SITE_NAME}</text>
    <text x="410" y="366" fill="${SLATE_600}" font-size="34">Mapa colaborativo de edificios afectados,</text>
    <text x="410" y="414" fill="${SLATE_600}" font-size="34">los recursos que necesitan y dónde donar.</text>
    <text x="410" y="506" fill="${SLATE_400}" font-size="28" font-weight="600">${DOMAIN}</text>
  </g>
</svg>`;

/** Icono cuadrado. `pad` deja margen para el recorte circular de Android (maskable). */
function icon(size, pad = 0.86) {
  const half = size / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="#ffffff" />
  ${marker(half, half, (half / 64) * pad)}
</svg>`;
}

async function render(name, svg, width) {
  const png = new Resvg(svg, {
    fitTo: { mode: "width", value: width },
    font: { loadSystemFonts: true, defaultFontFamily: "Segoe UI" },
  })
    .render()
    .asPng();
  await writeFile(new URL(name, OUT_DIR), png);
  console.log(`${name.padEnd(24)} ${(png.length / 1024).toFixed(1)} KB`);
}

await render("og.png", og, 1200);
// iOS no respeta la transparencia en el icono de inicio: fondo blanco explícito.
await render("apple-touch-icon.png", icon(180), 180);
await render("icon-192.png", icon(192), 192);
await render("icon-512.png", icon(512), 512);
// Android recorta el maskable a un círculo inscrito: el contenido se encoge
// para caber en la zona segura (~80% del lado).
await render("icon-512-maskable.png", icon(512, 0.62), 512);
