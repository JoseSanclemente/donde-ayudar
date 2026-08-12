/**
 * La imagen que sale del botón de compartir: un PNG de 1080×1920 —la historia de
 * Instagram y de WhatsApp, pantalla completa en un teléfono— con un recorte del
 * mapa arriba y la ficha del punto abajo.
 *
 * Se dibuja en el navegador y no en el servidor porque no hay servidor: el sitio
 * es estático (`astro.config.mjs` no tiene adapter) y tampoco hay una URL por
 * punto que un crawler pueda visitar. Por eso lo que se comparte es un archivo,
 * no un enlace con `og:image`.
 *
 * La ficha manda sobre el mapa: primero se mide todo lo que hay que decir y lo
 * que sobra se lo queda el recorte. Ningún insumo se esconde detrás de un «y 3
 * más» — quien lee la imagen tiene que saber qué llevar sin abrir nada.
 *
 * Módulo de dominio: no sabe de Leaflet, ni de los stores, ni del DOM de la
 * página. Recibe un `ShareCard` y devuelve un `Blob`. Quien lo llama es
 * `features/share.ts`; quien arma el `ShareCard` es `map.ts`.
 */
/**
 * El pie de la imagen es solo el dominio: en una historia se lee de reojo y
 * mientras pasa, y ahí un nombre y una URL compiten por el mismo segundo. Va
 * escrito acá y no sale de `consts.ts` a propósito — `SITE_URL` es el origen
 * desde donde se sirve el sitio, y este es el dominio que la gente teclea.
 */
const DOMAIN = "dondeayudar.com.co";

/** Insumo tal como se pinta en la imagen. `category` es un id de `CATEGORIES`. */
export type ShareChip = {
  label: string;
  category: string | null;
  /** Cubierto en un reporte, o en pausa en un punto: gris y sin color propio. */
  muted: boolean;
};

export type ShareCard = {
  /** «URGENTE», «Centro de acopio», «Banco de sangre», «Albergue». */
  kicker: string;
  /** Color del kicker y de las barras, en hexadecimal. */
  accent: string;
  name: string;
  /** Los puntos traen dirección; un reporte no. */
  address: string | null;
  /** Horario, teléfono, avisos: una línea de texto suelto cada una. */
  lines: string[];
  /** Título del bloque de chips («Recibe», «Necesita»). Vacío = sin bloque. */
  chipsTitle: string;
  chips: ShareChip[];
  marker: "pulse" | "square";
  lat: number;
  lng: number;
};

const WIDTH = 1080;
const HEIGHT = 1920;
/**
 * Cuánto puede medir el recorte del mapa. El alto real sale de lo que sobre
 * después de la ficha: un punto con veinte insumos se queda con el mínimo, uno
 * con tres se lleva el máximo.
 */
const MAP_MAX = 1040;
const MAP_MIN = 420;
const PAD = 72;
/** Barra de acento arriba y abajo, como en `public/og.png`. */
const BAR = 16;
/** Lo que se reserva abajo para el pie con el dominio. */
const FOOTER = 150;

const FONT = '"Figtree Variable", system-ui, -apple-system, sans-serif';

const WHITE = "#ffffff";
const SLATE_900 = "#0f172a";
const SLATE_600 = "#475569";
const SLATE_400 = "#94a3b8";
const SLATE_200 = "#e2e8f0";

/**
 * El gemelo en canvas de los `chip` de `CATEGORIES`. No se puede reusar el
 * catálogo: ahí los colores son clases de Tailwind y un canvas solo entiende
 * hexadecimales. Mismo motivo por el que `scripts/build-og.mjs` repite los
 * colores del marcador. Si se agrega una categoría, va también acá.
 */
const CHIP_HEX: Record<string, { bg: string; fg: string }> = {
  herramientas: { bg: "#fffbeb", fg: "#92400e" },
  rescate: { bg: "#fff7ed", fg: "#9a3412" },
  logistica: { bg: "#ecfeff", fg: "#155e75" },
  bebes: { bg: "#fdf2f8", fg: "#9d174d" },
  alimentos: { bg: "#ecfdf5", fg: "#065f46" },
  salud: { bg: "#f0f9ff", fg: "#075985" },
  voluntarios: { bg: "#f5f3ff", fg: "#5b21b6" },
};

/** Cubierto, en pausa, o de una categoría que ya no existe. */
const CHIP_MUTED = { bg: "#f1f5f9", fg: "#64748b" };

/* --------------------------------- Teselas -------------------------------- */

/** Calle, no barrio: a este zoom se reconoce la cuadra en la que queda el punto. */
const TILE_ZOOM = 17;
const TILE_SIZE = 256;
/** El mismo `light_all` del mapa, en @2x: al reducirlo el texto sale nítido. */
const TILE_URL = "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png";
const SUBDOMAINS = ["a", "b", "c", "d"];
/** Una tesela colgada no puede dejar el botón girando para siempre. */
const TILE_TIMEOUT_MS = 6000;

/** Punto del mundo en píxeles de tesela, en el zoom fijo de la imagen. */
function worldPixel(lat: number, lng: number): { x: number; y: number } {
  const scale = TILE_SIZE * 2 ** TILE_ZOOM;
  const sin = Math.sin((lat * Math.PI) / 180);
  return {
    x: ((lng + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale,
  };
}

function loadTile(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    // Sin esto el canvas queda contaminado y `toBlob` lanza SecurityError.
    // CARTO responde con `Access-Control-Allow-Origin: *`, así que la petición
    // anónima sirve.
    img.crossOrigin = "anonymous";
    const timer = setTimeout(() => reject(new Error("tile timeout")), TILE_TIMEOUT_MS);
    img.onload = () => {
      clearTimeout(timer);
      resolve(img);
    };
    img.onerror = () => {
      clearTimeout(timer);
      reject(new Error(`tile failed: ${url}`));
    };
    img.src = url;
  });
}

/**
 * Pinta el recorte del mapa centrado en el punto. Lanza si alguna tesela no
 * llega: quien llama decide qué dibujar en su lugar.
 */
async function drawMap(
  ctx: CanvasRenderingContext2D,
  lat: number,
  lng: number,
  mapHeight: number,
): Promise<void> {
  const center = worldPixel(lat, lng);
  const left = center.x - WIDTH / 2;
  const top = center.y - mapHeight / 2;

  const firstX = Math.floor(left / TILE_SIZE);
  const lastX = Math.floor((left + WIDTH) / TILE_SIZE);
  const firstY = Math.floor(top / TILE_SIZE);
  const lastY = Math.floor((top + mapHeight) / TILE_SIZE);

  const jobs: { x: number; y: number; image: Promise<HTMLImageElement> }[] = [];
  let n = 0;
  for (let x = firstX; x <= lastX; x += 1) {
    for (let y = firstY; y <= lastY; y += 1) {
      const url = TILE_URL.replace("{s}", SUBDOMAINS[n % SUBDOMAINS.length] as string)
        .replace("{z}", String(TILE_ZOOM))
        .replace("{x}", String(x))
        .replace("{y}", String(y));
      n += 1;
      jobs.push({ x, y, image: loadTile(url) });
    }
  }

  const images = await Promise.all(jobs.map((job) => job.image));
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, WIDTH, mapHeight);
  ctx.clip();
  jobs.forEach((job, i) => {
    ctx.drawImage(
      images[i] as HTMLImageElement,
      job.x * TILE_SIZE - left,
      job.y * TILE_SIZE - top,
      TILE_SIZE,
      TILE_SIZE,
    );
  });
  ctx.restore();
}

/* -------------------------------- Marcadores ------------------------------- */

/** El marcador de reporte: anillo tenue, aro y punto. Igual que en `build-og.mjs`. */
function pulseMarker(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  color: string,
): void {
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.16;
  ctx.beginPath();
  ctx.arc(cx, cy, 54, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = color;
  ctx.lineWidth = 9;
  ctx.beginPath();
  ctx.arc(cx, cy, 40, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, 21, 0, Math.PI * 2);
  ctx.fill();
}

/** El marcador de punto de donación: el mismo cuadrado del mapa, con borde blanco. */
function squareMarker(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  color: string,
): void {
  const half = 28;
  ctx.fillStyle = color;
  ctx.strokeStyle = WHITE;
  ctx.lineWidth = 8;
  roundRect(ctx, cx - half, cy - half, half * 2, half * 2, 12);
  ctx.fill();
  ctx.stroke();
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

/* ----------------------------------- Texto --------------------------------- */

/** Corta el texto en líneas que quepan en `maxWidth`, hasta `maxLines`. */
function wrap(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  let cut = false;
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    // `!current` deja pasar una palabra sola más ancha que la caja: se recorta
    // abajo, pero una línea vacía no arregla nada.
    if (ctx.measureText(candidate).width <= maxWidth || !current) {
      current = candidate;
      continue;
    }
    lines.push(current);
    current = word;
    if (lines.length === maxLines) {
      cut = true;
      break;
    }
  }
  if (!cut && current) lines.push(current);

  // Lo que se cortó se marca: una frase truncada que parece completa dice algo
  // que el punto no dijo.
  const last = lines[lines.length - 1];
  if (last !== undefined && (cut || ctx.measureText(last).width > maxWidth)) {
    let trimmed = last;
    while (trimmed.length > 1 && ctx.measureText(`${trimmed}…`).width > maxWidth) {
      trimmed = trimmed.slice(0, -1);
    }
    lines[lines.length - 1] = `${trimmed}…`;
  }
  return lines;
}

/* ----------------------------------- Chips --------------------------------- */

/**
 * El chip encoge cuando hay muchos insumos, y no por gusto: la lista completa es
 * el dato que la imagen viene a dar, así que lo que cede es el tamaño, nunca el
 * contenido.
 */
const CHIP_SIZES = [30, 27, 24, 21, 18];
const CHIP_GAP = 12;

function chipMetrics(size: number) {
  return {
    font: `600 ${size}px ${FONT}`,
    height: Math.round(size * 1.95),
    padX: Math.round(size * 0.95),
  };
}

/**
 * Recorre los chips envolviéndolos en filas y devuelve dónde queda cada uno.
 * Sirve para medir antes de dibujar: el alto del bloque decide cuánto mapa cabe.
 */
function layoutChips(
  ctx: CanvasRenderingContext2D,
  chips: ShareChip[],
  maxWidth: number,
  size: number,
): { placed: { chip: ShareChip; x: number; y: number; width: number }[]; height: number } {
  const { font, height, padX } = chipMetrics(size);
  ctx.font = font;

  const placed: { chip: ShareChip; x: number; y: number; width: number }[] = [];
  let x = 0;
  let y = 0;
  for (const chip of chips) {
    const width = ctx.measureText(chip.label).width + padX * 2;
    if (x + width > maxWidth && x > 0) {
      x = 0;
      y += height + CHIP_GAP;
    }
    placed.push({ chip, x, y, width });
    x += width + CHIP_GAP;
  }
  return { placed, height: chips.length === 0 ? 0 : y + height };
}

function drawChips(
  ctx: CanvasRenderingContext2D,
  placed: { chip: ShareChip; x: number; y: number; width: number }[],
  originX: number,
  originY: number,
  size: number,
): void {
  const { font, height, padX } = chipMetrics(size);
  ctx.font = font;
  ctx.textBaseline = "middle";
  for (const { chip, x, y, width } of placed) {
    const color = chip.muted
      ? CHIP_MUTED
      : (CHIP_HEX[chip.category ?? ""] ?? CHIP_MUTED);
    ctx.fillStyle = color.bg;
    roundRect(ctx, originX + x, originY + y, width, height, height / 2);
    ctx.fill();
    ctx.fillStyle = color.fg;
    ctx.fillText(chip.label, originX + x + padX, originY + y + height / 2 + 1);
  }
  ctx.textBaseline = "alphabetic";
}

/* ---------------------------------- Medida --------------------------------- */

const MAX_WIDTH = WIDTH - PAD * 2;
/** Espacio entre el borde del recorte y el kicker. */
const TOP_GAP = 92;
const KICKER_H = 68;
const NAME_H = 78;
const ADDRESS_H = 46;
const LINE_H = 44;
const CHIPS_TITLE_H = 34;

type Layout = {
  mapHeight: number;
  nameLines: string[];
  addressLines: string[];
  lineGroups: string[][];
  chipSize: number;
  chips: { chip: ShareChip; x: number; y: number; width: number }[];
  chipsHeight: number;
};

/**
 * Mide la ficha entera y reparte el alto: el texto y los insumos se llevan lo
 * que necesitan, el recorte del mapa se queda con el resto. Si ni con el chip
 * más pequeño cabe todo, el mapa baja hasta `MAP_MIN` y la ficha se estira sobre
 * él — antes que esconder un insumo.
 */
function measure(ctx: CanvasRenderingContext2D, card: ShareCard): Layout {
  ctx.font = `700 64px ${FONT}`;
  const nameLines = wrap(ctx, card.name, MAX_WIDTH, 3);

  ctx.font = `400 36px ${FONT}`;
  const addressLines = card.address ? wrap(ctx, card.address, MAX_WIDTH, 2) : [];

  ctx.font = `400 34px ${FONT}`;
  const lineGroups = card.lines.map((line) => wrap(ctx, line, MAX_WIDTH, 2));

  const textHeight =
    TOP_GAP +
    KICKER_H +
    nameLines.length * NAME_H +
    (addressLines.length > 0 ? addressLines.length * ADDRESS_H + 12 : 0) +
    lineGroups.reduce((total, group) => total + group.length * LINE_H, 0);

  let chipSize = CHIP_SIZES[CHIP_SIZES.length - 1] as number;
  let chips: Layout["chips"] = [];
  let chipsHeight = 0;
  for (const size of CHIP_SIZES) {
    const block = layoutChips(ctx, card.chips, MAX_WIDTH, size);
    chipSize = size;
    chips = block.placed;
    chipsHeight = block.height;
    const needed =
      textHeight + (card.chips.length > 0 ? CHIPS_TITLE_H + 28 + chipsHeight : 0) + FOOTER;
    if (HEIGHT - needed >= MAP_MIN) break;
  }

  const needed =
    textHeight + (card.chips.length > 0 ? CHIPS_TITLE_H + 28 + chipsHeight : 0) + FOOTER;
  const mapHeight = Math.max(MAP_MIN, Math.min(MAP_MAX, HEIGHT - needed));

  return { mapHeight, nameLines, addressLines, lineGroups, chipSize, chips, chipsHeight };
}

/* ---------------------------------- Ficha ---------------------------------- */

function drawCard(
  ctx: CanvasRenderingContext2D,
  card: ShareCard,
  layout: Layout,
  withMap: boolean,
): void {
  const mapHeight = withMap ? layout.mapHeight : 0;

  // El fondo blanco no puede pasar por encima del recorte del mapa, que ya está
  // pintado: con mapa solo se rellena de la franja hacia abajo.
  ctx.fillStyle = WHITE;
  if (withMap) ctx.fillRect(0, mapHeight, WIDTH, HEIGHT - mapHeight);
  else ctx.fillRect(0, 0, WIDTH, HEIGHT);

  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";

  if (withMap) {
    const center = mapHeight / 2;
    if (card.marker === "square") squareMarker(ctx, WIDTH / 2, center, card.accent);
    else pulseMarker(ctx, WIDTH / 2, center, card.accent);

    // La atribución no es decorativa: redistribuir las teselas dentro de una
    // imagen sin acreditarlas no está permitido.
    ctx.font = `500 20px ${FONT}`;
    ctx.textAlign = "right";
    const label = "© OpenStreetMap · CARTO";
    const width = ctx.measureText(label).width;
    ctx.fillStyle = "rgba(255,255,255,0.82)";
    ctx.fillRect(WIDTH - width - 24, mapHeight - 34, width + 24, 34);
    ctx.fillStyle = SLATE_600;
    ctx.fillText(label, WIDTH - 12, mapHeight - 11);
    ctx.textAlign = "left";

    ctx.fillStyle = SLATE_200;
    ctx.fillRect(0, mapHeight, WIDTH, 2);
  } else {
    // Sin mapa la ficha se queda sola: el marcador entra arriba para que la
    // imagen siga siendo reconocible como este sitio.
    if (card.marker === "square") squareMarker(ctx, PAD + 40, BAR + 120, card.accent);
    else pulseMarker(ctx, PAD + 40, BAR + 120, card.accent);
  }

  ctx.fillStyle = card.accent;
  ctx.fillRect(0, 0, WIDTH, BAR);

  let y = (withMap ? mapHeight : BAR + 130) + TOP_GAP;

  ctx.font = `700 32px ${FONT}`;
  ctx.fillStyle = card.accent;
  ctx.fillText(card.kicker.toUpperCase(), PAD, y);
  y += KICKER_H;

  ctx.font = `700 64px ${FONT}`;
  ctx.fillStyle = SLATE_900;
  for (const line of layout.nameLines) {
    ctx.fillText(line, PAD, y);
    y += NAME_H;
  }

  if (layout.addressLines.length > 0) {
    ctx.font = `400 36px ${FONT}`;
    ctx.fillStyle = SLATE_600;
    for (const line of layout.addressLines) {
      ctx.fillText(line, PAD, y);
      y += ADDRESS_H;
    }
    y += 12;
  }

  ctx.font = `400 34px ${FONT}`;
  ctx.fillStyle = SLATE_600;
  for (const group of layout.lineGroups) {
    for (const line of group) {
      ctx.fillText(line, PAD, y);
      y += LINE_H;
    }
  }

  if (card.chips.length > 0) {
    y += 28;
    ctx.font = `700 26px ${FONT}`;
    ctx.fillStyle = SLATE_400;
    ctx.fillText(card.chipsTitle.toUpperCase(), PAD, y);
    y += CHIPS_TITLE_H;
    drawChips(ctx, layout.chips, PAD, y, layout.chipSize);
  }

  ctx.fillStyle = card.accent;
  ctx.fillRect(0, HEIGHT - BAR, WIDTH, BAR);

  ctx.font = `700 40px ${FONT}`;
  ctx.fillStyle = SLATE_900;
  ctx.fillText(DOMAIN, PAD, HEIGHT - 56);
}

function toBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("toBlob returned null"));
    }, "image/png");
  });
}

/**
 * Dibuja la tarjeta y la devuelve como PNG. Si el mapa no se puede pintar
 * —teselas caídas, red bloqueada, canvas contaminado— la vuelve a dibujar sin
 * él: una imagen sin mapa sirve, un botón que lanza no.
 */
export async function renderShareCard(card: ShareCard): Promise<Blob> {
  // La fuente tiene que estar cargada antes de medir nada: si no, la primera
  // imagen de la sesión se mide con la tipografía de respaldo y el texto sale
  // corrido.
  try {
    await document.fonts.load(`700 64px ${FONT}`);
    await document.fonts.ready;
  } catch {
    // Sin Figtree se dibuja igual, con la de respaldo del sistema.
  }

  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context");

  const layout = measure(ctx, card);

  try {
    await drawMap(ctx, card.lat, card.lng, layout.mapHeight);
    drawCard(ctx, card, layout, true);
    return await toBlob(canvas);
  } catch {
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    drawCard(ctx, card, layout, false);
    return toBlob(canvas);
  }
}
