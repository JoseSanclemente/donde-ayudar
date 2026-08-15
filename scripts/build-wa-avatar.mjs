/**
 * Renders the WhatsApp bot profile picture (`assets/whatsapp-avatar.png`) from
 * the same pin as `public/favicon.svg`.
 *
 *   pnpm wa-avatar
 *
 * 640x640 is what WhatsApp asks for, and it crops to a circle: the pin is sized
 * to stay inside that circle with margin, so no part of it is cut in the chat
 * list. White background, because a transparent PNG turns black in some
 * clients.
 *
 * Run by hand and commit the PNG, like `scripts/build-og.mjs`. The file lives
 * outside `public/` on purpose: it is uploaded to Meta, not served by the site.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { Resvg } from "@resvg/resvg-js";

const OUT = new URL("../assets/whatsapp-avatar.png", import.meta.url);

const SIZE = 640;
const RED = "#dc2626";

// The pin of `public/favicon.svg`, in its own 24x24 space.
const PIN =
  "M12.404 20.802C14.028 19.97 20 16.568 20 11.5C20 7 16.267 4 12 4c-4.124 0-8 3-8 7.5c0 5.068 5.972 8.47 7.596 9.302a.88.88 0 0 0 .808 0m-.635-6.045L8.97 11.81a1.806 1.806 0 1 1 2.898-2.107l.07.128a.07.07 0 0 0 .124 0l.07-.128c.658-1.212 2.377-1.27 3.114-.104c.443.7.354 1.61-.216 2.21l-2.799 2.947c-.092.097-.139.146-.195.157a.2.2 0 0 1-.072 0c-.056-.011-.103-.06-.195-.157";

// Drawn bounds of the pin inside that 24x24 box, measured off the path.
const PIN_BOX = { x: 4, y: 4, w: 16, h: 17.2 };
const PIN_HEIGHT = 430;

const scale = PIN_HEIGHT / PIN_BOX.h;
const tx = SIZE / 2 - (PIN_BOX.x + PIN_BOX.w / 2) * scale;
const ty = SIZE / 2 - (PIN_BOX.y + PIN_BOX.h / 2) * scale;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
  <rect width="${SIZE}" height="${SIZE}" fill="#ffffff"/>
  <g transform="translate(${tx} ${ty}) scale(${scale})">
    <path fill="${RED}" fill-rule="evenodd" clip-rule="evenodd" d="${PIN}"/>
  </g>
</svg>`;

const png = new Resvg(svg, { fitTo: { mode: "width", value: SIZE } })
  .render()
  .asPng();

await mkdir(new URL("../assets/", import.meta.url), { recursive: true });
await writeFile(OUT, png);
console.log(`assets/whatsapp-avatar.png  ${SIZE}x${SIZE}  ${png.length} bytes`);
