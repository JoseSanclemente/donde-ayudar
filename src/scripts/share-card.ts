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
 * La ficha se lee en el orden en que se decide ir: qué es —el kicker—, cómo se
 * llama, dónde queda, desde cuándo se sabe, el detalle suelto, lo que escribió
 * quien reportó y qué hace falta llevar.
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


export type ShareChip = {
  label: string;
  category: string | null;
  
  muted: boolean;
};

export type ShareCard = {
  
  kicker: string;
  
  accent: string;
  name: string;
  /**
   * La línea secundaria bajo el nombre. En un punto es la dirección; en un
   * reporte, donde `name` ya es la dirección, es el nombre del lugar — y va
   * vacía cuando nadie lo escribió.
   */
  address: string | null;
  /**
   * «Actualizado hace 2 h». Va pegado a la identidad del punto —el dato no vale
   * lo mismo si se leyó hace diez minutos que hace dos días—. Un punto de
   * donación no lo tiene: `null`.
   */
  updated: string | null;
  
  lines: string[];
  
  notes: string[];
  
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

const BAR = 16;

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
  "primeros-auxilios": { bg: "#f0f9ff", fg: "#075985" },
  medicamentos: { bg: "#f0fdfa", fg: "#115e59" },
  "aseo-personal": { bg: "#eff6ff", fg: "#1e40af" },
  mascotas: { bg: "#fdf4ff", fg: "#86198f" },
  voluntarios: { bg: "#f5f3ff", fg: "#5b21b6" },
};


const CHIP_MUTED = { bg: "#f1f5f9", fg: "#64748b" };



/**
 * Calle, no barrio: al tamaño con que se dibujan, a este zoom se reconoce la
 * cuadra en la que queda el punto. Zoom 16 y no 17 por el peso: el mismo
 * recorte son unas nueve teselas en vez de treinta, y treinta teselas @2x son
 * más de un mega que una conexión lenta no baja dentro de `MAP_TIMEOUT_MS`.
 */
const TILE_ZOOM = 16;
/**
 * Lo que mide una tesela en el lienzo. Una @2x son 512 píxeles reales, así que
 * dibujarla a 512 es dibujarla 1:1 — sin reescalar, que es donde el texto de un
 * mapa se ensucia. El encuadre no cambia: 1080 píxeles cubren 2,1 teselas de
 * zoom 16 a 512, el mismo trozo de ciudad que cubrían 4,2 de zoom 17 a 256.
 *
 * Es también la unidad de `worldPixel()`, y por eso el píxel del mundo y el
 * píxel del lienzo son el mismo número en todo el módulo.
 */
const TILE_DRAW = 512;

const TILE_URL =
  "https:
const SUBDOMAINS = ["a", "b", "c", "d"];

const TILE_TIMEOUT_MS = 6000;
/**
 * El tope del recorte entero, y no la suma de los topes de cada tesela: se
 * bajan en paralelo, así que veinte teselas lentas esperan veinte veces lo
 * mismo.
 *
 * Ocho segundos y no cuatro, a sabiendas de que Chrome solo le da cinco al
 * gesto del visitante: en una conexión lenta el mapa tarda más que eso y sigue
 * llegando, y quedarse sin recorte —que es lo que la imagen viene a mostrar—
 * es peor que caer en la descarga. Pasados los cinco, `navigator.share()`
 * rechaza y `features/share.ts` entrega el PNG por descarga; el mapa se pierde
 * solo cuando de verdad no llegó.
 */
const MAP_TIMEOUT_MS = 8000;


function worldPixel(lat: number, lng: number): { x: number; y: number } {
  const scale = TILE_DRAW * 2 ** TILE_ZOOM;
  const sin = Math.sin((lat * Math.PI) / 180);
  return {
    x: ((lng + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale,
  };
}

function loadTile(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    
    
    
    img.crossOrigin = "anonymous";
    const timer = setTimeout(
      () => reject(new Error("tile timeout")),
      TILE_TIMEOUT_MS,
    );
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


function tileJobs(
  lat: number,
  lng: number,
  mapHeight: number,
): {
  left: number;
  top: number;
  jobs: { x: number; y: number; url: string }[];
} {
  const center = worldPixel(lat, lng);
  const left = center.x - WIDTH / 2;
  const top = center.y - mapHeight / 2;

  const firstX = Math.floor(left / TILE_DRAW);
  const lastX = Math.floor((left + WIDTH) / TILE_DRAW);
  const firstY = Math.floor(top / TILE_DRAW);
  const lastY = Math.floor((top + mapHeight) / TILE_DRAW);

  const jobs: { x: number; y: number; url: string }[] = [];
  let n = 0;
  for (let x = firstX; x <= lastX; x += 1) {
    for (let y = firstY; y <= lastY; y += 1) {
      const url = TILE_URL.replace(
        "{s}",
        SUBDOMAINS[n % SUBDOMAINS.length] as string,
      )
        .replace("{z}", String(TILE_ZOOM))
        .replace("{x}", String(x))
        .replace("{y}", String(y));
      n += 1;
      jobs.push({ x, y, url });
    }
  }
  return { left, top, jobs };
}

/**
 * Pide las teselas del recorte sin dibujarlas y sin esperar por ellas, para que
 * estén en la caché del navegador cuando alguien toque el botón. Los fallos no
 * importan acá: el dibujo de verdad las vuelve a pedir.
 */
export function prefetchShareTiles(card: ShareCard): void {
  const { jobs } = tileJobs(card.lat, card.lng, MAP_MAX);
  for (const job of jobs) void loadTile(job.url).catch(() => {});
}

/**
 * Pinta el recorte del mapa centrado en el punto, con las teselas que hayan
 * llegado: una que falte deja un cuadro gris, no tumba la imagen entera —en una
 * conexión lenta, un recorte incompleto dice mucho más que ningún recorte.
 *
 * La excepción es la tesela del centro, donde va el marcador: sin ella el
 * marcador flota sobre un vacío y señala un lugar que la imagen no muestra. Ahí
 * sí lanza, y quien llama decide qué dibujar en su lugar.
 */
async function drawMap(
  ctx: CanvasRenderingContext2D,
  lat: number,
  lng: number,
  mapHeight: number,
): Promise<void> {
  const { left, top, jobs } = tileJobs(lat, lng, mapHeight);
  const centerX = Math.floor((left + WIDTH / 2) / TILE_DRAW);
  const centerY = Math.floor((top + mapHeight / 2) / TILE_DRAW);

  const results = await Promise.allSettled(
    jobs.map((job) => loadTile(job.url)),
  );

  const missingCenter = jobs.some(
    (job, i) =>
      job.x === centerX &&
      job.y === centerY &&
      results[i]?.status !== "fulfilled",
  );
  if (missingCenter) throw new Error("center tile missing");

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, WIDTH, mapHeight);
  ctx.clip();
  
  
  ctx.fillStyle = SLATE_200;
  ctx.fillRect(0, 0, WIDTH, mapHeight);
  jobs.forEach((job, i) => {
    const result = results[i];
    if (result?.status !== "fulfilled") return;
    ctx.drawImage(
      result.value,
      job.x * TILE_DRAW - left,
      job.y * TILE_DRAW - top,
      TILE_DRAW,
      TILE_DRAW,
    );
  });
  ctx.restore();
}




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

  
  
  const last = lines[lines.length - 1];
  if (last !== undefined && (cut || ctx.measureText(last).width > maxWidth)) {
    let trimmed = last;
    while (
      trimmed.length > 1 &&
      ctx.measureText(`${trimmed}…`).width > maxWidth
    ) {
      trimmed = trimmed.slice(0, -1);
    }
    lines[lines.length - 1] = `${trimmed}…`;
  }
  return lines;
}



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
): {
  placed: { chip: ShareChip; x: number; y: number; width: number }[];
  height: number;
} {
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



const MAX_WIDTH = WIDTH - PAD * 2;

const TOP_GAP = 92;
const KICKER_H = 68;
const NAME_H = 78;
const ADDRESS_H = 46;
const UPDATED_H = 42;
const LINE_H = 44;
const NOTE_H = 42;

const NOTES_GAP = 20;
const CHIPS_TITLE_H = 34;

const UPDATED_FONT = `400 32px ${FONT}`;
const NOTE_FONT = `italic 400 34px ${FONT}`;

type Layout = {
  mapHeight: number;
  nameLines: string[];
  addressLines: string[];
  updatedLine: string | null;
  lineGroups: string[][];
  noteGroups: string[][];
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
  const addressLines = card.address
    ? wrap(ctx, card.address, MAX_WIDTH, 2)
    : [];

  ctx.font = UPDATED_FONT;
  const updatedLine = card.updated
    ? (wrap(ctx, card.updated, MAX_WIDTH, 1)[0] ?? null)
    : null;

  ctx.font = `400 34px ${FONT}`;
  const lineGroups = card.lines.map((line) => wrap(ctx, line, MAX_WIDTH, 2));

  ctx.font = NOTE_FONT;
  const noteGroups = card.notes.map((note) =>
    wrap(ctx, `“${note}”`, MAX_WIDTH, 2),
  );

  const notesHeight =
    noteGroups.length === 0
      ? 0
      : NOTES_GAP +
        noteGroups.reduce((total, group) => total + group.length * NOTE_H, 0);

  const textHeight =
    TOP_GAP +
    KICKER_H +
    nameLines.length * NAME_H +
    (addressLines.length > 0 ? addressLines.length * ADDRESS_H + 12 : 0) +
    (updatedLine ? UPDATED_H : 0) +
    lineGroups.reduce((total, group) => total + group.length * LINE_H, 0) +
    notesHeight;

  let chipSize = CHIP_SIZES[CHIP_SIZES.length - 1] as number;
  let chips: Layout["chips"] = [];
  let chipsHeight = 0;
  for (const size of CHIP_SIZES) {
    const block = layoutChips(ctx, card.chips, MAX_WIDTH, size);
    chipSize = size;
    chips = block.placed;
    chipsHeight = block.height;
    const needed =
      textHeight +
      (card.chips.length > 0 ? CHIPS_TITLE_H + 28 + chipsHeight : 0) +
      FOOTER;
    if (HEIGHT - needed >= MAP_MIN) break;
  }

  const needed =
    textHeight +
    (card.chips.length > 0 ? CHIPS_TITLE_H + 28 + chipsHeight : 0) +
    FOOTER;
  const mapHeight = Math.max(MAP_MIN, Math.min(MAP_MAX, HEIGHT - needed));

  return {
    mapHeight,
    nameLines,
    addressLines,
    updatedLine,
    lineGroups,
    noteGroups,
    chipSize,
    chips,
    chipsHeight,
  };
}



function drawCard(
  ctx: CanvasRenderingContext2D,
  card: ShareCard,
  layout: Layout,
  withMap: boolean,
): void {
  const mapHeight = withMap ? layout.mapHeight : 0;

  
  
  ctx.fillStyle = WHITE;
  if (withMap) ctx.fillRect(0, mapHeight, WIDTH, HEIGHT - mapHeight);
  else ctx.fillRect(0, 0, WIDTH, HEIGHT);

  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";

  if (withMap) {
    const center = mapHeight / 2;
    if (card.marker === "square")
      squareMarker(ctx, WIDTH / 2, center, card.accent);
    else pulseMarker(ctx, WIDTH / 2, center, card.accent);

    
    
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
    
    
    if (card.marker === "square")
      squareMarker(ctx, PAD + 40, BAR + 120, card.accent);
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

  
  
  if (layout.updatedLine) {
    ctx.font = UPDATED_FONT;
    ctx.fillStyle = SLATE_400;
    ctx.fillText(layout.updatedLine, PAD, y);
    y += UPDATED_H;
  }

  ctx.font = `400 34px ${FONT}`;
  ctx.fillStyle = SLATE_600;
  for (const group of layout.lineGroups) {
    for (const line of group) {
      ctx.fillText(line, PAD, y);
      y += LINE_H;
    }
  }

  
  
  if (layout.noteGroups.length > 0) {
    y += NOTES_GAP;
    ctx.font = NOTE_FONT;
    ctx.fillStyle = SLATE_600;
    for (const group of layout.noteGroups) {
      for (const line of group) {
        ctx.fillText(line, PAD, y);
        y += NOTE_H;
      }
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
  ctx.textAlign = "right";
  ctx.fillText(DOMAIN, WIDTH - PAD, HEIGHT - 56);
  ctx.textAlign = "left";
}

function newCanvas(): {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
} {
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context");
  return { canvas, ctx };
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
  
  
  
  try {
    await document.fonts.load(`700 64px ${FONT}`);
    await document.fonts.ready;
  } catch {
    
  }

  const { canvas, ctx } = newCanvas();

  const layout = measure(ctx, card);

  try {
    await Promise.race([
      drawMap(ctx, card.lat, card.lng, layout.mapHeight),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("map timeout")), MAP_TIMEOUT_MS),
      ),
    ]);
    drawCard(ctx, card, layout, true);
    return await toBlob(canvas);
  } catch {
    
    
    
    
    const fallback = newCanvas();
    drawCard(fallback.ctx, card, layout, false);
    return toBlob(fallback.canvas);
  }
}
