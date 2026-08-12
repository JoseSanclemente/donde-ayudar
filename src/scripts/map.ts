import L from "leaflet";
import type { ReportGroup } from "./cluster";
import { recibeInsumos, type Centro } from "./centros";
import {
  ALBERGUE_FILTER,
  byCategory,
  categoryChip,
  categoryItemsEnPunto,
  categoryLabel,
  COVERED_CHIP,
  SANGRE_FILTER,
} from "./resources";
import { markerEstado, statusInfo } from "./status";
import { isMobile, onBreakpointChange } from "./ui/breakpoint";
import { chipLabel, chipStyle } from "./ui/chips";
import { telUrl, whatsappUrl } from "./ui/contact";
import { directionsUrl, escapeHtml, NAV_ICON } from "./ui/html";
import { relativeTime } from "./ui/time";

export const CALI_CENTER: [number, number] = [3.4516, -76.532];

/** Group key -> its marker. One marker per point, never one per report. */
const markers = new Map<string, L.Marker>();
/** Report id -> the key of the group it was merged into. */
const keyByReport = new Map<string, string>();
let map: L.Map;
let pickHandler: ((latlng: L.LatLng) => void) | null = null;

const pulseIcon = L.divIcon({
  className: "pulse-marker",
  // The outer marker element carries Leaflet's positioning transform, so the
  // inner wrapper is what GSAP animates — otherwise the two fight over it.
  //
  // Los dos anillos van siempre en el HTML y el CSS decide cuáles se ven: el
  // icono se crea una sola vez y se comparte entre todos los marcadores, así
  // que la forma no puede depender del estado de un reporte concreto.
  html: '<span class="pulse-inner"><span class="pulse-ring"></span><span class="pulse-ring pulse-ring-2"></span><span class="pulse-dot"></span></span>',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
  popupAnchor: [0, -12],
});

/**
 * Lo que el mapa necesita saber de un reporte y no vive en la fila: hace cuánto
 * se sabe algo del punto y si eso ya quedó viejo. Llega por parámetro para que
 * `map.ts` no tenga que importar los stores.
 */
export type MarkerExtra = {
  /** Lo más reciente que se sabe: creación, cambio de estado o novedad. */
  freshAt: string;
  /** Última novedad publicada sobre el punto, si hay. */
  lastUpdate?: string;
  stale: boolean;
};

/** Bloque de contacto del popup: nombre en texto y, si hay número, CTA a WhatsApp. */
function contactHtml(name: string, phone: string | null): string {
  const who = `<p class="text-xs text-slate-600">Contacto: ${escapeHtml(name)}</p>`;
  if (!phone) return who;
  const wa = whatsappUrl(phone);
  return `
    ${who}
    <a
      class="centro-cta flex w-full items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold no-underline shadow-sm transition hover:bg-emerald-700"
      href="${escapeHtml(wa ?? telUrl(phone))}"
      ${wa ? 'target="_blank" rel="noopener noreferrer"' : ""}
    >${escapeHtml(phone)} — confirma antes de ir</a>`;
}

/**
 * Los recursos de la zona, repartidos por categoría: doce chips seguidos no
 * dicen si falta agua o falta herramienta. Dentro de cada bloque se respeta el
 * orden que ya trae el grupo — pendientes primero, cubiertos al final.
 */
function resourcesHtml(group: ReportGroup): string {
  const blocks = byCategory(group.resources, (resource) => resource.name).map((bucket) => {
    const chips = bucket.items
      .map(
        (resource) =>
          `<span class="inline-block ${chipStyle(resource.name, resource.covered)}">${escapeHtml(
            chipLabel(resource.name, resource.covered),
          )}</span>`,
      )
      .join(" ");
    return `
      <div>
        <p class="text-[11px] font-semibold uppercase tracking-wide text-slate-500">${escapeHtml(bucket.label)}</p>
        <div class="mt-1 flex flex-wrap gap-1">${chips}</div>
      </div>`;
  });
  return blocks.join("");
}

function reportPopupHtml(group: ReportGroup, extra: MarkerExtra): string {
  const lead = group.lead;
  const date = new Date(lead.createdAt).toLocaleString("es-CO", {
    dateStyle: "medium",
    timeStyle: "short",
  });
  const resolved =
    group.resources.length > 0 && group.pending === 0
      ? '<p class="text-xs font-medium text-emerald-700">Necesidades cubiertas</p>'
      : "";

  // Sin esta línea, los recursos de tres reportes distintos aparecerían juntos
  // sin explicación de por qué.
  const count = group.reports.length;
  const cuantos =
    count > 1
      ? `<p class="text-xs text-slate-500">${count} reportes en este punto</p>`
      : "";

  const info = statusInfo(group.status);
  // El estado encabeza el popup: antes de saber qué falta hay que saber si se
  // puede llegar.
  const kicker = `<span class="inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${info.chip}">${escapeHtml(info.aviso)}</span>`;

  // Una hora fresca respalda el dato; una vieja advierte que ya no lo hace.
  const fresh = `<p class="text-xs ${extra.stale ? "font-medium text-amber-700" : "text-slate-500"}">Actualizado ${escapeHtml(relativeTime(extra.freshAt))}${extra.stale ? " — confirma antes de ir" : ""}</p>`;

  const lastUpdate = extra.lastUpdate
    ? `<p class="text-xs text-slate-600">«${escapeHtml(extra.lastUpdate)}»</p>`
    : "";

  // Las notas y los contactos son de toda la zona, con el mismo tope de dos que
  // usa la lista: más que eso convierte el popup en un muro.
  const notes = group.reports
    .filter((r) => r.note)
    .slice(0, 2)
    .map((r) => `<p class="text-xs leading-snug text-slate-600">“${escapeHtml(r.note as string)}”</p>`)
    .join("");

  // Confirmar antes de desplazarse es el consejo que repite toda la página: sin
  // un botón para hacerlo, es un consejo sin salida.
  const contacto = group.reports
    .filter((r) => r.contactName)
    .slice(0, 2)
    .map((r) => contactHtml(r.contactName as string, r.contactPhone))
    .join("");

  return `
    <div class="space-y-2">
      ${kicker}
      <p class="text-sm font-semibold text-slate-900">${escapeHtml(lead.name)}</p>
      ${cuantos}
      <div class="space-y-2">${resourcesHtml(group)}</div>
      ${resolved}
      ${notes}
      ${lastUpdate}
      ${fresh}
      ${contacto}
      <p class="text-xs text-slate-400">Reportado el ${escapeHtml(date)}</p>
    </div>`;
}

/* ---- Detalle del marcador: popup en escritorio, bottom sheet en móvil ---- */

/**
 * Lo que ve quien toca un marcador. Es el mismo HTML del popup: el sheet es otro
 * envase para el mismo contenido, no una segunda versión que mantener.
 */
export type MarkerSelection = { html: string; lat: number; lng: number };

let selectHandler: ((selection: MarkerSelection | null) => void) | null = null;
let selected: L.Marker | null = null;
// El HTML del popup se guarda aparte porque en móvil el marcador no lo lleva
// bindeado: sin popup, `getPopup()` no tiene nada que devolver.
const popupHtml = new WeakMap<L.Marker, string>();

/** `null` = lo que estaba abierto dejó de existir; el panel debe cerrarse. */
export function onMarkerSelect(handler: (selection: MarkerSelection | null) => void): void {
  selectHandler = handler;
}

function emit(marker: L.Marker | null): void {
  selected = marker;
  if (!marker) {
    selectHandler?.(null);
    return;
  }
  const { lat, lng } = marker.getLatLng();
  selectHandler?.({ html: popupHtml.get(marker) ?? "", lat, lng });
}

/** Lo llama el panel al cerrarse: sin esto el marcador seguiría «abierto». */
export function clearSelection(): void {
  selected = null;
}

/**
 * En móvil el marcador ni siquiera lleva popup: la burbuja de Leaflet queda
 * bajo el header y los botones flotantes, así que el detalle va al sheet. Atar
 * el popup y cerrarlo a mano dejaría un parpadeo en cada toque.
 */
function attachPopup(marker: L.Marker, html: string): void {
  // Cada emisión del store repinta todos los marcadores, y casi siempre con el
  // mismo HTML: sin esta salida, un popup abierto se reparsea entero en cada
  // tick de realtime aunque no haya cambiado una letra.
  if (popupHtml.get(marker) === html) return;
  popupHtml.set(marker, html);
  if (isMobile()) marker.unbindPopup();
  else if (marker.getPopup()) marker.setPopupContent(html);
  else marker.bindPopup(html);
}

function selectOnMobile(event: L.LeafletMouseEvent): void {
  if (!isMobile()) return;
  emit(event.target as L.Marker);
}

/** Al cruzar el breakpoint hay que devolverle (o quitarle) el popup a cada marcador. */
function syncPopupMode(): void {
  const all = [...markers.values(), ...centros.map((centro) => centro.marker)];
  for (const marker of all) {
    const html = popupHtml.get(marker);
    if (html === undefined) continue;
    if (isMobile()) marker.unbindPopup();
    else if (!marker.getPopup()) marker.bindPopup(html);
  }
  if (isMobile()) map?.closePopup();
  // En escritorio el panel de detalle no existe: la selección se descarta para
  // no reaparecer al volver a angostar la ventana.
  else if (selected) emit(null);
}

export function initMap(containerId: string): L.Map {
  map = L.map(containerId, { zoomControl: true }).setView(CALI_CENTER, 13);

  // Positron: OSM data, minimal gray-on-white render — no POI icons, sparse
  // labels — so the red report markers are the only saturated thing on screen.
  L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
    maxZoom: 20,
    subdomains: "abcd",
    // Durante la animación de zoom el nivel intermedio no se ve casi: pedir y
    // pintar esas teselas es trabajo que cae justo en los frames del gesto.
    updateWhenZooming: false,
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
  }).addTo(map);

  centrosLayer.addTo(map);

  map.on("click", (event: L.LeafletMouseEvent) => {
    if (!pickHandler) return;
    const handler = pickHandler;
    stopPicking();
    handler(event.latlng);
  });

  // Mientras dura el gesto los anillos se pausan (regla `.is-moving` en
  // global.css). No se pierde información: el punto sigue ahí y del mismo color,
  // solo deja de latir el rato que el mapa está en movimiento.
  const container = map.getContainer();
  map.on("movestart zoomstart", () => container.classList.add("is-moving"));
  map.on("moveend zoomend", () => container.classList.remove("is-moving"));

  onBreakpointChange(syncPopupMode);

  return map;
}

/** El contenedor cambia de tamaño al cruzar el breakpoint o al rotar. */
export function refreshSize(): void {
  map?.invalidateSize();
}

/* ---- Marcador provisional: se arrastra hasta el edificio exacto ---- */

const draftIcon = L.divIcon({
  className: "draft-marker",
  html: '<span class="draft-pin"></span>',
  iconSize: [22, 22],
  iconAnchor: [11, 11],
});

let draftMarker: L.Marker | null = null;
let draftHandler: ((lat: number, lng: number) => void) | null = null;

export function showDraft(
  lat: number,
  lng: number,
  onMove: (lat: number, lng: number) => void,
): void {
  draftHandler = onMove;
  if (draftMarker) {
    draftMarker.setLatLng([lat, lng]);
    return;
  }
  draftMarker = L.marker([lat, lng], {
    icon: draftIcon,
    draggable: true,
    autoPan: true,
    zIndexOffset: 1000,
  })
    .addTo(map)
    .bindTooltip("Arrástrame hasta el edificio", { direction: "top", offset: [0, -14] });

  draftMarker.on("drag", () => {
    const { lat: dLat, lng: dLng } = draftMarker!.getLatLng();
    draftHandler?.(dLat, dLng);
  });
}

export function hideDraft(): void {
  draftMarker?.remove();
  draftMarker = null;
  draftHandler = null;
}

/**
 * Un solo atributo con la forma que toca, y no cinco clases que se pisan. La
 * precedencia entre estado, cubierto y urgencia vive en `status.ts`.
 */
function paintEstado(marker: L.Marker, group: ReportGroup, extra: MarkerExtra): void {
  const el = marker.getElement();
  if (!el) return;
  const covered = group.resources.length > 0 && group.pending === 0;
  const estado = markerEstado(group.status, covered);
  // Escribir el mismo valor igual invalida el estilo del subárbol, y acá eso son
  // N marcadores recalculados en cada emisión del store. `classList.toggle` no
  // hace falta protegerlo: si el estado no cambia, no toca el DOM.
  if (el.dataset.estado !== estado) el.dataset.estado = estado;
  el.classList.toggle("is-stale", extra.stale);
}

/** What the map needs about one point: the group and the freshness around it. */
export type MarkerEntry = { group: ReportGroup; extra: MarkerExtra };

/**
 * One marker per group, not per report: three reports in the same building are
 * three pins stacked on top of each other saying the same thing, and the popup
 * already speaks for the whole zone.
 *
 * The whole reconciliation lives here because the two registries do: the caller
 * hands over the points that should exist and this decides what to create,
 * refresh or drop.
 */
export function syncReportMarkers(entries: MarkerEntry[]): void {
  keyByReport.clear();

  for (const { group, extra } of entries) {
    for (const id of group.reportIds) keyByReport.set(id, group.key);

    let marker = markers.get(group.key);
    if (marker) {
      // The anchor is stable (see `groupReports`), so this only fires if the
      // group's oldest report was the one deleted.
      const at = marker.getLatLng();
      if (at.lat !== group.lat || at.lng !== group.lng) marker.setLatLng([group.lat, group.lng]);
    } else {
      marker = L.marker([group.lat, group.lng], { icon: pulseIcon }).addTo(map);
      marker.on("click", selectOnMobile);
      markers.set(group.key, marker);
    }

    attachPopup(marker, reportPopupHtml(group, extra));
    paintEstado(marker, group, extra);
    // With the detail open, a status change or a covered resource has to show
    // up right there: the sheet doesn't find out on its own.
    if (marker === selected) emit(marker);
  }

  const live = new Set(entries.map(({ group }) => group.key));
  for (const key of [...markers.keys()]) if (!live.has(key)) dropMarker(key);
}

function dropMarker(key: string): void {
  const marker = markers.get(key);
  if (!marker) return;
  markers.delete(key);
  // El punto ya no existe: dejar su detalle abierto sería mostrar algo que el
  // mapa ya no tiene.
  if (marker === selected) emit(null);
  marker.remove();
}

/** The group a report was merged into — its marker, if any, is that group's. */
export function markerKeyForReport(id: string): string | undefined {
  return keyByReport.get(id);
}

/**
 * Inner wrapper of the marker holding this report — safe to animate, unlike the
 * positioned root.
 */
export function getMarkerElement(id: string): HTMLElement | undefined {
  const key = keyByReport.get(id);
  const el = key ? markers.get(key)?.getElement() : undefined;
  return (el?.querySelector(".pulse-inner") as HTMLElement | null) ?? undefined;
}

export function flyTo(lat: number, lng: number, zoom = 17): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      map.off("moveend", finish);
      resolve();
    };
    // A flyTo to the current view emits no moveend, so never await it forever.
    const timer = setTimeout(finish, 1500);
    map.once("moveend", () => {
      clearTimeout(timer);
      finish();
    });
    map.flyTo([lat, lng], zoom, { duration: 1.2 });
  });
}

/* ---- Centros de acopio: capa curada, fija, aparte de los reportes ---- */

// Van en su propia capa para poder filtrarlos y ocultarlos sin tocar los
// reportes, y con zIndexOffset negativo para que el rojo pulsante de una
// necesidad activa siempre quede por encima de un punto de entrega.
const centrosLayer = L.layerGroup();
const centros: Array<{ data: Centro; marker: L.Marker }> = [];
let centroFilter: string | null = null;
let centrosVisible = true;

const centroIcon = L.divIcon({
  className: "centro-marker",
  html: '<span class="centro-pin"></span>',
  iconSize: [16, 16],
  iconAnchor: [8, 8],
  popupAnchor: [0, -10],
});

// Mismo cuadrado que un acopio, en gris y con barras de pausa: sigue siendo el
// mismo sitio, solo que ahora mismo no recibe. Se queda en el mapa a propósito
// — borrarlo dejaría sin explicación a quien ya lo vio ayer.
const pausaIcon = L.divIcon({
  className: "centro-marker",
  html: '<span class="centro-pin" data-pausa></span>',
  iconSize: [16, 16],
  iconAnchor: [8, 8],
  popupAnchor: [0, -10],
});

const sangreIcon = L.divIcon({
  className: "sangre-marker",
  html: '<span class="sangre-pin"></span>',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
  popupAnchor: [0, -11],
});

// Casita ámbar: tercer tipo, tercera forma. Ni el cuadrado del acopio ni el
// círculo del banco de sangre, para que se distinga también sin color.
const albergueIcon = L.divIcon({
  className: "albergue-marker",
  html: '<span class="albergue-pin"></span>',
  iconSize: [20, 20],
  iconAnchor: [10, 10],
  popupAnchor: [0, -12],
});

const alberguePausaIcon = L.divIcon({
  className: "albergue-marker",
  html: '<span class="albergue-pin" data-pausa></span>',
  iconSize: [20, 20],
  iconAnchor: [10, 10],
  popupAnchor: [0, -12],
});

/** Icono por tipo con su variante en pausa. `sangre` no se pausa: no lleva par. */
const ICON: Record<Centro["tipo"], { normal: L.DivIcon; pausa?: L.DivIcon }> = {
  acopio: { normal: centroIcon, pausa: pausaIcon },
  sangre: { normal: sangreIcon },
  albergue: { normal: albergueIcon, pausa: alberguePausaIcon },
};

/** Un punto que recibe insumos y hoy no lo hace. Un banco de sangre nunca lo está. */
function enPausa(centro: Centro): boolean {
  return recibeInsumos(centro) && !centro.recibiendo;
}

/** Etiqueta y color del kicker por tipo. Un cuarto tipo es una entrada más. */
const KICKER: Record<Centro["tipo"], { label: string; color: string }> = {
  acopio: { label: "Centro de acopio", color: "text-indigo-700" },
  sangre: { label: "Banco de sangre", color: "text-rose-700" },
  albergue: { label: "Albergue", color: "text-amber-700" },
};

/**
 * Lo que recibe un punto curado, categoría por categoría y con el detalle
 * debajo: «Logística y energía» no le dice a nadie que ahí sirven unas pilas.
 * El detalle sale del catálogo de `resources.ts`, que es el mismo que ofrece el
 * formulario — no hay un segundo listado que se pueda desactualizar.
 */
function recibeHtml(centro: Centro, pausa: boolean): string {
  if (!recibeInsumos(centro)) return "";
  const blocks = centro.recibe.map((id) => {
    // En pausa el chip va tachado, con el mismo `COVERED_CHIP` de un recurso ya
    // cubierto: sigue siendo lo que ese centro recibe, pero no ahora.
    const chip = `<span class="inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
      pausa ? COVERED_CHIP : categoryChip(id)
    }">${escapeHtml(categoryLabel(id))}</span>`;
    const items = categoryItemsEnPunto(id);
    // Una categoría sin ítems en el catálogo —«Voluntarios» los tiene, pero una
    // futura podría no— se queda con el chip solo, no con dos puntos vacíos.
    const detalle = items.length
      ? `<p class="mt-1 text-xs leading-snug ${pausa ? "text-slate-400" : "text-slate-500"}">${escapeHtml(items.join(", "))}</p>`
      : "";
    return `<div>${chip}${detalle}</div>`;
  });
  // Con el detalle debajo, los chips dejaron de leerse solos: sin este título
  // parecen lo que el punto necesita, no lo que entrega quien va.
  return `
    <div class="space-y-1.5">
      <p class="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Recibe</p>
      ${blocks.join("")}
    </div>`;
}

function centroPopupHtml(centro: Centro): string {
  const pausa = enPausa(centro);
  const recibe = recibeHtml(centro, pausa);
  const telefono = centro.telefono
    ? `<p class="text-xs text-slate-600">Tel. ${escapeHtml(centro.telefono)}</p>`
    : "";
  const notas = centro.notas
    ? `<p class="text-xs text-slate-500">${escapeHtml(centro.notas)}</p>`
    : "";
  // El estado va en el kicker y no solo en el color del pin: quien abre el popup
  // tiene que leerlo antes que la dirección.
  const { label, color } = KICKER[centro.tipo];
  const kicker = pausa
    ? `<p class="text-xs font-semibold uppercase tracking-wide text-slate-500">${label} · No recibe por ahora</p>`
    : `<p class="text-xs font-semibold uppercase tracking-wide ${color}">${label}</p>`;
  const notaEstado =
    recibeInsumos(centro) && centro.nota_estado
      ? `<p class="text-xs text-slate-600">${escapeHtml(centro.nota_estado)}</p>`
      : "";
  // Mismo ámbar que el aviso de un reporte viejo: "existe, pero no te desplaces".
  const aviso = pausa
    ? `<p class="text-xs font-medium text-amber-700">No recibe donaciones por ahora</p>${notaEstado}`
    : "";
  // En pausa el CTA deja de ser el azul sólido: sigue disponible para quien
  // quiera ubicarlo, pero no invita al viaje.
  const ctaClass = pausa
    ? "centro-cta centro-cta-quiet mt-1 flex w-full items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold no-underline transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-slate-300"
    : "centro-cta mt-1 flex w-full items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold no-underline shadow-sm transition hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-300";
  return `
    <div class="space-y-2">
      ${kicker}
      <p class="text-sm font-semibold text-slate-900">${escapeHtml(centro.name)}</p>
      ${aviso}
      <p class="text-xs text-slate-600">${escapeHtml(centro.direccion)}</p>
      <p class="text-xs text-slate-600">${escapeHtml(centro.horario)}</p>
      ${recibe}
      ${telefono}
      ${notas}
      <a
        class="${ctaClass}"
        href="${directionsUrl(centro.lat, centro.lng)}"
        target="_blank"
        rel="noopener noreferrer"
      >${NAV_ICON}Cómo llegar</a>
    </div>`;
}

// `SANGRE_FILTER` y `ALBERGUE_FILTER` son valores reservados del filtro, no ids de
// `CATEGORIES`: filtran por tipo de punto, mientras que los demás filtran por qué
// se recibe — y por eso alcanzan a acopios y albergues por igual.
function matchesFilter(centro: Centro): boolean {
  if (centroFilter === null) return true;
  if (centroFilter === SANGRE_FILTER) return centro.tipo === "sangre";
  if (centroFilter === ALBERGUE_FILTER) return centro.tipo === "albergue";
  return recibeInsumos(centro) && centro.recibe.includes(centroFilter);
}

/** Repuebla la capa. Devuelve cuántos centros quedaron visibles. */
function applyCentros(): number {
  centrosLayer.clearLayers();
  let shown = 0;
  if (centrosVisible) {
    for (const { data, marker } of centros) {
      if (!matchesFilter(data)) continue;
      centrosLayer.addLayer(marker);
      shown += 1;
    }
  }
  // Un filtro que esconde el punto abierto deja el detalle hablando de algo que
  // ya no está en el mapa.
  const openCentro = selected !== null && centros.some(({ marker }) => marker === selected);
  if (openCentro && !centrosLayer.hasLayer(selected as L.Marker)) emit(null);
  return shown;
}

export function setCentros(list: Centro[]): number {
  // La lista se reconstruye entera: los marcadores viejos —y con ellos el que
  // estuviera abierto— dejan de existir.
  if (selected && centros.some(({ marker }) => marker === selected)) emit(null);
  centros.length = 0;
  for (const data of list) {
    // El estado es dato de build y no cambia en runtime, así que el icono se
    // elige una sola vez acá — no hace falta repintar el DOM en `applyCentros`
    // como con `paintEstado` de los reportes.
    const { normal, pausa } = ICON[data.tipo];
    const icon = enPausa(data) && pausa ? pausa : normal;
    const marker = L.marker([data.lat, data.lng], {
      icon,
      zIndexOffset: -500,
    });
    attachPopup(marker, centroPopupHtml(data));
    marker.on("click", selectOnMobile);
    centros.push({ data, marker });
  }
  return applyCentros();
}

/** `null` = todas las categorías. */
export function setCentroFilter(categoryId: string | null): number {
  centroFilter = categoryId;
  return applyCentros();
}

export function setCentrosVisible(visible: boolean): number {
  centrosVisible = visible;
  return applyCentros();
}

export function startPicking(onPick: (latlng: L.LatLng) => void): void {
  pickHandler = onPick;
  map.getContainer().classList.add("picking");
}

export function stopPicking(): void {
  pickHandler = null;
  map.getContainer().classList.remove("picking");
}

export function isPicking(): boolean {
  return pickHandler !== null;
}
