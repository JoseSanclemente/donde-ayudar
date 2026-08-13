import L from "leaflet";
import type { ReportGroup } from "./cluster";
import { isCommunity, isExpired, type Center } from "./centers";
import {
  ALBERGUE_FILTER,
  byCategory,
  categoryIdOf,
  SANGRE_FILTER,
} from "./resources";
import { readCachedCoords } from "./geolocation";
import type { ShareCard } from "./share-card";
import { markerEstado, statusInfo, type ReportStatus } from "./status";
import { isMobile, onBreakpointChange } from "./ui/breakpoint";
import { chipLabel, chipStyle } from "./ui/chips";
import { contactCtaHtml, contactLinksHtml } from "./ui/contact";
import {
  directionsUrl,
  escapeHtml,
  linkifyHtml,
  NAV_ICON,
  SHARE_ICON,
  stripUrls,
} from "./ui/html";
import { statusSelectHtml } from "./ui/status-select";
import { relativeTime } from "./ui/time";

/** El respaldo: sin ubicación, el mapa abre donde empezó todo. */
export const CALI_CENTER: [number, number] = [3.4516, -76.532];

/** Zoom para la vista inicial sobre la persona: su ciudad entera, no su calle. */
const USER_ZOOM = 14;

/**
 * Whether something already decided what the map is looking at — a gesture, a
 * geocoded suggestion, a draft pin. From then on the initial view is nobody's
 * to set: the permission prompt can answer half a minute later and must not
 * pull the map away from what the person asked for.
 */
let viewClaimed = false;

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

/* ---- Compartir: la ficha que dibuja `share-card.ts` para la imagen ---- */

/**
 * Lo que hay que saber de un punto para dibujar su imagen, listo desde que se
 * arma el popup. Va en un registro y no en atributos `data-` del botón porque
 * habría que serializar los chips y escapar el HTML dos veces; acá el objeto ya
 * está armado y `features/share.ts` lo pide por llave.
 *
 * Las llaves llevan prefijo —`r:` un grupo de reportes, `c:` un punto— porque
 * los dos registros se repintan por su cuenta y cada uno solo puede borrar lo
 * suyo.
 */
const shareCards = new Map<string, ShareCard>();

export function getShareCard(key: string): ShareCard | null {
  return shareCards.get(key) ?? null;
}

function dropShareCards(prefix: string): void {
  for (const key of [...shareCards.keys()])
    if (key.startsWith(prefix)) shareCards.delete(key);
}

/** El color del estado en hexadecimal: el canvas no entiende clases de Tailwind. */
const STATUS_ACCENT: Record<ReportStatus, string> = {
  activo: "#ef4444",
  urgente: "#b91c1c",
  saturado: "#b45309",
  cerrado: "#64748b",
};

/**
 * El botón de compartir. Es un icono y no un botón con texto porque va al lado
 * de «Cómo llegar», que es a lo que viene todo el mundo y se queda con todo el
 * peso; en el popup de un reporte —donde no hay CTA— va solo, alineado a la
 * derecha, con las mismas clases para que se reconozca como el mismo control.
 */
function shareButtonHtml(key: string): string {
  return `<button
        type="button"
        data-share="${escapeHtml(key)}"
        aria-label="Compartir este punto"
        title="Compartir"
        class="flex shrink-0 items-center justify-center rounded-lg border border-slate-300 bg-white p-2.5 text-slate-600 transition hover:bg-slate-50 hover:text-slate-900 disabled:opacity-60"
      >${SHARE_ICON}</button>`;
}

/**
 * Bloque de contacto del popup: sin número, el nombre en texto; con número, el
 * mismo CTA que las listas, que lo arma `ui/contact`.
 */
function contactHtml(name: string, phone: string | null): string {
  if (!phone)
    return `<p class="text-sm text-slate-600">Contacto: ${escapeHtml(name)}</p>`;
  return contactCtaHtml(name, phone, "mt-2");
}

/**
 * Los recursos de la zona, repartidos por categoría: doce chips seguidos no
 * dicen si falta agua o falta herramienta. Dentro de cada bloque se respeta el
 * orden que ya trae el grupo — pendientes primero, cubiertos al final.
 */
function resourcesHtml(group: ReportGroup): string {
  // Un reporte puede llegar sin insumos: la dirección es lo único obligatorio.
  // La línea ocupa el lugar de los chips para que el hueco se lea como una
  // invitación y no como un popup a medio dibujar.
  if (group.resources.length === 0)
    return `<p class="text-sm text-slate-500">Todavía no dice qué necesita.</p>`;

  const blocks = byCategory(group.resources, (resource) => resource.name).map(
    (bucket) => {
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
    },
  );
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

  // Una hora fresca respalda el dato; una vieja advierte que ya no lo hace.
  const fresh = `<p class="text-xs ${extra.stale ? "font-medium text-amber-700" : "text-slate-500"}">Actualizado ${escapeHtml(relativeTime(extra.freshAt))}${extra.stale ? " — confirma antes de ir" : ""}</p>`;

  // El estado encabeza el popup: antes de saber qué falta hay que saber si se
  // puede llegar. Va como selector y no como chip de lectura porque cambiarlo es
  // comunitario, y quien está parado frente al punto es quien lo sabe — el chip
  // solo le dejaba la opción de ir a buscar la fila en la lista. La hora viaja
  // pegada al selector porque un estado viejo no es un estado: enterarse abajo
  // del todo de que nadie lo confirma desde ayer llega tarde.
  const kicker = `
      ${statusSelectHtml(group.status, group.reportIds, lead.name)}
      ${fresh}`;

  // Encima de la dirección y más pequeño: es el nombre que se dice por teléfono,
  // pero el que lleva hasta el punto sigue siendo el de abajo.
  const lugar = lead.placeName
    ? `<p class="text-base text-slate-600">${escapeHtml(lead.placeName)}</p>`
    : "";

  const lastUpdate = extra.lastUpdate
    ? `<p class="text-xs text-slate-600">«${escapeHtml(extra.lastUpdate)}»</p>`
    : "";

  // Las notas y los contactos son de toda la zona, con el mismo tope de dos que
  // usa la lista: más que eso convierte el popup en un muro.
  const noteList = group.reports
    .filter((r) => r.note)
    .slice(0, 2)
    .map((r) => r.note as string);
  const notes = noteList
    .map(
      (note) =>
        `<p class="text-sm leading-snug text-slate-600">“${escapeHtml(note)}”</p>`,
    )
    .join("");

  // Confirmar antes de desplazarse es el consejo que repite toda la página: sin
  // un botón para hacerlo, es un consejo sin salida.
  const contacto = group.reports
    .filter((r) => r.contactName)
    .slice(0, 2)
    .map((r) => contactHtml(r.contactName as string, r.contactPhone))
    .join("");

  // La misma información del popup, en el orden en que se lee, para la imagen
  // que sale del botón de compartir. Los recursos cubiertos van en gris, igual
  // que sus chips acá.
  const shareKey = `r:${group.key}`;
  shareCards.set(shareKey, {
    kicker: statusInfo(group.status).label,
    accent: STATUS_ACCENT[group.status] ?? STATUS_ACCENT.activo,
    name: lead.name,
    // Invertido respecto al popup: en la imagen la dirección se queda con la
    // línea grande y el nombre del lugar cae debajo, en la ranura secundaria que
    // ya existe. La jerarquía es la misma —manda la dirección—, y la ficha no
    // gana una tercera medida de texto.
    address: lead.placeName,
    updated: `Actualizado ${relativeTime(extra.freshAt)}`,
    // El estado ya lo dice el kicker; acá solo va lo que él no cabe a decir.
    lines: [count > 1 ? `${count} reportes en este punto` : ""].filter(Boolean),
    notes: noteList,
    chipsTitle: "Necesita",
    chips: group.resources.map((resource) => ({
      label: resource.name,
      category: categoryIdOf(resource.name) ?? null,
      muted: resource.covered,
    })),
    marker: "pulse",
    lat: group.lat,
    lng: group.lng,
  });

  return `
    <div class="space-y-2">
      ${kicker}
      <div class="flex flex-col justify-between gap-2">
        ${lugar}
        <p class="text-lg font-semibold text-slate-900">${escapeHtml(lead.name)}</p>
      </div>
      ${cuantos}
      <div class="space-y-2">${resourcesHtml(group)}</div>
      ${resolved}
      ${notes}
      ${lastUpdate}
      ${contacto}
      <div class="flex items-center justify-between gap-2">
        <p class="text-xs text-slate-400">Reportado el ${escapeHtml(date)}</p>
        ${shareButtonHtml(shareKey)}
      </div>
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
export function onMarkerSelect(
  handler: (selection: MarkerSelection | null) => void,
): void {
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
  const all = [
    ...markers.values(),
    ...[...centers.values()].map((center) => center.marker),
  ];
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
  // La visita anterior ya dijo dónde está: se arranca ahí de una, sin esperar a
  // que el permiso conteste y sin el salto desde Cali a medio dibujar.
  const cached = readCachedCoords();
  map = L.map(containerId, { zoomControl: true }).setView(
    cached ? [cached.lat, cached.lng] : CALI_CENTER,
    cached ? USER_ZOOM : 13,
  );

  // Positron: OSM data, minimal gray-on-white render — no POI icons, sparse
  // labels — so the red report markers are the only saturated thing on screen.
  L.tileLayer(
    "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
    {
      maxZoom: 20,
      subdomains: "abcd",
      // Durante la animación de zoom el nivel intermedio no se ve casi: pedir y
      // pintar esas teselas es trabajo que cae justo en los frames del gesto.
      updateWhenZooming: false,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    },
  ).addTo(map);

  centersLayer.addTo(map);

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

  // Un gesto sobre el mapa vale más que cualquier vista automática: desde el
  // primero, la vista inicial ya no se toca. No se escucha `movestart` porque
  // ese lo dispara también el mapa solo.
  const claim = () => claimView();
  for (const event of ["pointerdown", "wheel", "keydown"] as const) {
    container.addEventListener(event, claim, { once: true, passive: true });
  }

  onBreakpointChange(syncPopupMode);

  return map;
}

/** El contenedor cambia de tamaño al cruzar el breakpoint o al rotar. */
export function refreshSize(): void {
  map?.invalidateSize();
}

/** Nadie más decide la vista inicial a partir de aquí. */
function claimView(): void {
  viewClaimed = true;
}

/**
 * Centra el mapa en la persona, si todavía nadie pidió mirar otra cosa. Va con
 * `setView` y no con `flyTo`: esto es de dónde arranca el mapa, y un vuelo de
 * segundo y pico entre dos ciudades se ve como un mapa que se escapa.
 */
export function setInitialView(lat: number, lng: number): void {
  if (viewClaimed) return;
  claimView();
  map.setView([lat, lng], USER_ZOOM);
}

/* ---- «Estás acá»: el punto de referencia para leer lo que hay alrededor ---- */

// Azul: el único color que el vocabulario de marcadores no había gastado —rojo
// reporte, índigo acopio, rosa sangre, ámbar albergue, gris pausado—, y el que
// todo el mundo ya asocia con su propia posición. Sin animación: latir es lo que
// distingue a un reporte vivo del resto del mapa.
const meIcon = L.divIcon({
  className: "me-marker",
  html: '<span class="me-dot"></span>',
  iconSize: [16, 16],
  iconAnchor: [8, 8],
});

let meMarker: L.Marker | null = null;

/**
 * Dibuja dónde está la persona. No mueve la vista: pintar el punto no es pedir
 * que se mire, y el permiso puede contestar cuando ya se está mirando otra cosa.
 */
export function setUserMarker(lat: number, lng: number): void {
  if (meMarker) {
    meMarker.setLatLng([lat, lng]);
    return;
  }
  meMarker = L.marker([lat, lng], {
    icon: meIcon,
    // No tiene nada que decir y no puede robarse el clic de un reporte que le
    // caiga encima: es referencia, no destino.
    interactive: false,
    keyboard: false,
    zIndexOffset: -400,
  }).addTo(map);
}

/** `false` si todavía no se sabe dónde está la persona. */
export function flyToUser(): boolean {
  if (!meMarker) return false;
  const { lat, lng } = meMarker.getLatLng();
  // A quien ya se acercó a su cuadra, volver a su punto no puede alejarlo.
  void flyTo(lat, lng, Math.max(map.getZoom(), USER_ZOOM));
  return true;
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
  claimView();
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
    .bindTooltip("Arrástrame hasta el edificio", {
      direction: "top",
      offset: [0, -14],
    });

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
function paintEstado(
  marker: L.Marker,
  group: ReportGroup,
  extra: MarkerExtra,
): void {
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
  // Las fichas para compartir se rehacen con los popups, una por grupo vivo.
  dropShareCards("r:");

  for (const { group, extra } of entries) {
    for (const id of group.reportIds) keyByReport.set(id, group.key);

    let marker = markers.get(group.key);
    if (marker) {
      // The anchor is stable (see `groupReports`), so this only fires if the
      // group's oldest report was the one deleted.
      const at = marker.getLatLng();
      if (at.lat !== group.lat || at.lng !== group.lng)
        marker.setLatLng([group.lat, group.lng]);
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

/**
 * `offsetY` pushes the target that many pixels above the container centre —
 * what a caller needs when something covers the lower half of the map and the
 * point has to land on the strip that is left.
 */
export function flyTo(
  lat: number,
  lng: number,
  zoom = 17,
  offsetY = 0,
): Promise<void> {
  claimView();
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
    let target = L.latLng(lat, lng);
    if (offsetY)
      target = map.unproject(map.project(target, zoom).add([0, offsetY]), zoom);
    map.flyTo(target, zoom, { duration: 1.2 });
  });
}

/* ---- Centers: their own layer, apart from the reports ---- */

// They go in their own layer so they can be filtered and hidden without
// touching the reports, and with a negative zIndexOffset so the pulsing red of
// an active need always stays above a delivery point.
const centersLayer = L.layerGroup();
/**
 * Center -> its marker, by id. A registry and not a list that gets rebuilt,
 * because the marker has to survive the emission: anyone can register a
 * collection point anywhere in the city, that arrives over realtime, and
 * rebuilding the whole layer closed the detail somebody was reading of another
 * point. Reconciled like the reports: create, refresh or drop.
 */
const centers = new Map<string, { data: Center; marker: L.Marker }>();
let centerFilter: string | null = null;
let centersVisible = true;

const collectionIcon = L.divIcon({
  className: "center-marker",
  html: '<span class="center-pin"></span>',
  iconSize: [16, 16],
  iconAnchor: [8, 8],
  popupAnchor: [0, -10],
});

// Registered by the community: the same square, a lighter indigo. Who published
// it does not change what the point is, so it does not change the shape either
// — a third outline would read as a fifth type. The popup is what says it in
// full, and it labels both origins.
const communityIcon = L.divIcon({
  className: "center-marker",
  html: '<span class="center-pin" data-community></span>',
  iconSize: [16, 16],
  iconAnchor: [8, 8],
  popupAnchor: [0, -10],
});

// The same square, grey and with the pause bars: still the same place, only it
// is not open right now. It stays on the map on purpose — deleting it would
// leave whoever saw it yesterday with no explanation.
const collectionPausedIcon = L.divIcon({
  className: "center-marker",
  html: '<span class="center-pin" data-paused></span>',
  iconSize: [16, 16],
  iconAnchor: [8, 8],
  popupAnchor: [0, -10],
});

// A red drop, tip up. The tip is the coordinate, and the rotation carries it
// about four pixels above the box, so the anchor goes negative.
const bloodIcon = L.divIcon({
  className: "blood-marker",
  html: '<span class="blood-pin"></span>',
  iconSize: [18, 18],
  iconAnchor: [9, -4],
  popupAnchor: [0, -2],
});

const bloodPausedIcon = L.divIcon({
  className: "blood-marker",
  html: '<span class="blood-pin" data-paused></span>',
  iconSize: [18, 18],
  iconAnchor: [9, -4],
  popupAnchor: [0, -2],
});

// A small amber house: third type, third shape, so it can be told apart with no
// colour at all.
const shelterIcon = L.divIcon({
  className: "shelter-marker",
  html: '<span class="shelter-pin"></span>',
  iconSize: [20, 20],
  iconAnchor: [10, 10],
  popupAnchor: [0, -12],
});

const shelterPausedIcon = L.divIcon({
  className: "shelter-marker",
  html: '<span class="shelter-pin" data-paused></span>',
  iconSize: [20, 20],
  iconAnchor: [10, 10],
  popupAnchor: [0, -12],
});

// A blue circle with a white cross — the shape the blood bank used to carry,
// which says «medical attention» more directly than it ever said «blood».
const healthcareIcon = L.divIcon({
  className: "healthcare-marker",
  html: '<span class="healthcare-pin"></span>',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
  popupAnchor: [0, -11],
});

const healthcarePausedIcon = L.divIcon({
  className: "healthcare-marker",
  html: '<span class="healthcare-pin" data-paused></span>',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
  popupAnchor: [0, -11],
});

/** Icon per type with its paused variant. */
const ICON: Record<Center["type"], { normal: L.DivIcon; paused: L.DivIcon }> = {
  acopio: { normal: collectionIcon, paused: collectionPausedIcon },
  sangre: { normal: bloodIcon, paused: bloodPausedIcon },
  albergue: { normal: shelterIcon, paused: shelterPausedIcon },
  healthcare: { normal: healthcareIcon, paused: healthcarePausedIcon },
};

/**
 * A point that does not count as open today: either it is not active, or it
 * expired.
 *
 * Two different facts, one drawing. The grey square with the pause bars already
 * says «this exists, do not walk over there yet», which is exactly what an
 * unconfirmed point says too — a second grey would only ask the reader to tell
 * two greys apart. What does change is the wording of the popup.
 */
function isPaused(center: Center): boolean {
  return !center.isActive || isExpired(center);
}

/**
 * Who published the point. Both origins are labelled and not only the community
 * one: «created by the community» says nothing if the alternative goes
 * unmarked, and the question it answers — did anybody verify this? — needs both
 * answers in sight.
 */
const ORIGIN: Record<Center["origin"], string> = {
  curado: "Creado por la alcaldía",
  comunidad: "Creado por la comunidad",
};

/**
 * What precedes the time in the notice of an expired point. It is apart because
 * the same text is the `data-time-prefix` the ticker uses to repaint it.
 */
const CONFIRM_PREFIX = "Nadie confirma este punto desde ";

/**
 * Kicker label and colour per type. `accent` is the same colour as `color` in
 * hexadecimal: the share image is drawn on a canvas, and a Tailwind class means
 * nothing there.
 */
const KICKER: Record<Center["type"], { label: string; color: string; accent: string }> = {
  acopio: {
    label: "Centro de acopio",
    color: "text-indigo-700",
    accent: "#4338ca",
  },
  sangre: {
    label: "Banco de sangre",
    color: "text-rose-700",
    accent: "#be123c",
  },
  albergue: { label: "Albergue", color: "text-amber-700", accent: "#b45309" },
  healthcare: {
    label: "Atención de heridos",
    color: "text-blue-700",
    accent: "#1d4ed8",
  },
};

/**
 * What a point takes, a chip per supply and the category as a title — the same
 * build as `resourcesHtml`. What the point listed are those supplies and not
 * the whole category, so the chip has to be the supply: it is the only thing
 * that compares at a glance against a report's chips.
 */
function donationsHtml(center: Center, paused: boolean): string {
  if (center.donations.length === 0) return "";
  const blocks = byCategory(center.donations, (item) => item).map((bucket) => {
    // Paused, the chips go struck through, in the same grey as an already
    // covered resource: it is still what that center takes, only not now.
    const chips = bucket.items
      .map(
        (item) =>
          `<span class="inline-block ${chipStyle(item, paused)}">${escapeHtml(item)}</span>`,
      )
      .join(" ");
    return `
      <div>
        <p class="text-[11px] font-semibold uppercase tracking-wide text-slate-500">${escapeHtml(bucket.label)}</p>
        <div class="mt-1 flex flex-wrap gap-1">${chips}</div>
      </div>`;
  });
  // With the detail underneath, the chips stopped reading on their own: without
  // this title they look like what the point needs, not what the visitor
  // brings.
  return `
    <div class="space-y-2">
      <p class="text-xs m-0 font-semibold uppercase tracking-wide text-slate-500">Recibe</p>
      ${blocks.join("")}
    </div>`;
}

/**
 * A center and whether it belongs to whoever is looking. Like `MarkerExtra`:
 * what does not live in the row comes in as a parameter, so `map.ts` never
 * imports the stores. `features/centers-layer.ts` is what computes it.
 */
export type CenterEntry = { data: Center; mine: boolean };

function centerPopupHtml(center: Center, mine: boolean): string {
  const paused = isPaused(center);
  // Expired and inactive draw the same and read differently. A point a
  // maintainer also greyed out counts as inactive: there somebody wrote the
  // reason, and it is worth more than «nobody has confirmed this».
  const expired = center.isActive && isExpired(center);
  const donations = donationsHtml(center, paused);
  const contact = contactLinksHtml(center.contactWhatsapp, center.contactInstagram);
  // A shelter that asks people to fill a form before showing up leaves the URL
  // here, and as dead text it is no use. Only curated points get linkified: a
  // community one is inserted by anyone from the browser, and making that text
  // clickable would be publishing whoever's link. `break-words` goes in both
  // cases — a URL is a single word and stretches the popup if it cannot break.
  const notes = center.notes
    ? `<p class="text-sm break-words text-slate-500">${
        isCommunity(center) ? escapeHtml(center.notes) : linkifyHtml(center.notes)
      }</p>`
    : "";
  // The state goes in the kicker and not only in the pin colour: whoever opens
  // the popup has to read it before the address.
  const { label, color, accent } = KICKER[center.type];
  const kickerLabel = expired
    ? `${label} · Sin confirmar`
    : paused
      ? `${label} · Cerrado por ahora`
      : label;
  const kicker = paused
    ? `<p class="text-xs font-semibold uppercase tracking-wide text-slate-500">${kickerLabel}</p>`
    : `<p class="text-xs font-semibold uppercase tracking-wide ${color}">${label}</p>`;
  // A blood bank does not take supplies but donors: saying «donaciones» flat
  // leaves the reader wondering whether the door is still open to give blood.
  const notAcceptingLabel =
    center.type === "sangre" ? "No recibe donantes por ahora" : "No recibe donaciones por ahora";
  // The colour is not the pin's: `accepting_donations` writes a line and
  // nothing else, so a point that is open but full keeps its own colour.
  const notAccepting = center.acceptingDonations
    ? ""
    : `<p class="text-xs font-medium text-amber-700">${notAcceptingLabel}</p>`;
  // Same amber as the notice of an old report: "it exists, but do not travel".
  // An expired point says something else — nobody claims it closed, only that
  // nobody has confirmed it in a while — and that is why it carries the time.
  // `data-time` lets the counter keep running with the popup open.
  const notice = expired
    ? `<p
        class="text-xs font-medium text-amber-700"
        data-time="${escapeHtml(center.updatedAt)}"
        data-time-prefix="${CONFIRM_PREFIX}"
      >${CONFIRM_PREFIX}${relativeTime(center.updatedAt)}</p>`
    : paused
      ? `<p class="text-xs font-medium text-amber-700">Cerrado por ahora</p>`
      : "";
  // Paused, the CTA stops being the solid blue: still there for whoever wants
  // to locate it, but it does not invite the trip.
  //
  // No `w-full` and no `mt-1`: the CTA shares a row with the share button, so
  // `flex-1` splits the width and the margin lives in the container.
  const ctaClass = paused
    ? "center-cta center-cta-quiet flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-4 py-2 text-md font-semibold no-underline transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-slate-300"
    : "center-cta flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-md font-semibold no-underline shadow-sm transition hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-300";
  const origin = `<p class="text-sm text-slate-500">${ORIGIN[center.origin]}</p>`;
  // The two conditions of the delete policy, and that is why both are here:
  // offering the button over a curated point would be offering something the
  // server rejects.
  const remove =
    mine && isCommunity(center)
      ? `<button
        type="button"
        data-delete-center="${escapeHtml(center.id)}"
        data-point-name="${escapeHtml(center.name)}"
        class="mt-1 w-full text-xs font-medium text-slate-400 transition hover:text-red-600"
      >Eliminar este punto</button>`
      : "";
  // Anyone can touch it, not only the author: the session the point was
  // registered with dies when the browser is cleared, and a point nobody can
  // revive stays expired forever.
  const confirm = expired
    ? `<button
        type="button"
        data-confirm-center="${escapeHtml(center.id)}"
        class="mt-2 w-full rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-800 transition hover:bg-amber-100 focus:outline-none focus:ring-2 focus:ring-amber-300"
      >Sigue abierto</button>`
    : "";
  const shareKey = `c:${center.id}`;
  shareCards.set(shareKey, {
    kicker: paused ? kickerLabel : label,
    accent: paused ? "#64748b" : accent,
    name: center.name,
    address: center.address,
    updated: null,
    lines: [
      center.hours,
      // The image travels over WhatsApp and gets looked at days later, so the
      // exact hour says nothing: what helps is that the point is unconfirmed.
      expired ? "Sin confirmar recientemente" : paused ? "Cerrado por ahora" : "",
      center.acceptingDonations ? "" : notAcceptingLabel,
      center.contactWhatsapp ? `WhatsApp ${center.contactWhatsapp}` : "",
      center.contactInstagram ? `Instagram @${center.contactInstagram}` : "",
      ORIGIN[center.origin],
    ].filter(Boolean),
    // No URLs: they cannot be tapped in the PNG, and `wrap()` lets a word wider
    // than the box through, so a raw URL runs off the drawing.
    notes: [center.notes].map((note) => (note ? stripUrls(note) : "")).filter(Boolean),
    chipsTitle: "Recibe",
    chips: center.donations.map((item) => ({
      label: item,
      category: categoryIdOf(item) ?? null,
      muted: paused,
    })),
    marker: "square",
    lat: center.lat,
    lng: center.lng,
  });

  // Name, who published it and where it is are the same answer — «what is this
  // and where» — so they go together in one block.
  return `
    <div class="space-y-2">
      <div class="space-y-1">
        ${kicker}
        <p class="text-lg font-semibold leading-tight text-slate-900 mt-3">${escapeHtml(center.name)}</p>
        ${origin}
        <p data-address class="text-xs text-slate-600">${escapeHtml(center.address)}</p>
      </div>
      ${notice}
      ${notAccepting}
      <p class="text-xs text-slate-600">${escapeHtml(center.hours)}</p>
      ${donations}
      ${contact}
      ${notes}
      <div class="mt-1 flex items-stretch gap-2">
        <a
          class="${ctaClass}"
          href="${directionsUrl(center.lat, center.lng)}"
          target="_blank"
          rel="noopener noreferrer"
        >${NAV_ICON}Cómo llegar</a>
        ${shareButtonHtml(shareKey)}
      </div>
      ${confirm}
      ${remove}
    </div>`;
}

// `SANGRE_FILTER` and `ALBERGUE_FILTER` are reserved filter values, not ids of
// `CATEGORIES`: they filter by point type, while the rest filter by what a
// point takes.
function matchesFilter(center: Center): boolean {
  if (centerFilter === null) return true;
  if (centerFilter === SANGRE_FILTER) return center.type === "sangre";
  if (centerFilter === ALBERGUE_FILTER) return center.type === "albergue";
  return center.donations.some((item) => categoryIdOf(item) === centerFilter);
}

/**
 * Puts the ones that pass the filter in the layer and takes the rest out.
 * Marker by marker and not with `clearLayers()`: emptying the whole layer rips
 * out of the DOM the ones about to be added back in the same pass, and with
 * them the popup open on top. Returns how many stayed visible.
 */
function applyCenters(): number {
  let shown = 0;
  for (const { data, marker } of centers.values()) {
    const visible = centersVisible && matchesFilter(data);
    if (visible) shown += 1;
    if (visible === centersLayer.hasLayer(marker)) continue;
    if (visible) centersLayer.addLayer(marker);
    else centersLayer.removeLayer(marker);
  }
  // A filter that hides the open point leaves the detail talking about
  // something no longer on the map.
  if (selected && !centersLayer.hasLayer(selected) && isCenterMarker(selected)) emit(null);
  return shown;
}

function isCenterMarker(marker: L.Marker): boolean {
  for (const { marker: candidate } of centers.values()) if (candidate === marker) return true;
  return false;
}

/**
 * The icon a point gets. Chosen on every emission and not once: greying a point
 * out in Supabase arrives as a new row over the same id, and the marker stays —
 * what changes is the drawing.
 */
function centerIconFor(center: Center): L.DivIcon {
  const { normal, paused } = ICON[center.type];
  // Only the collection point has a community variant: it is the only type the
  // form registers. Grey wins over origin — «do not go today» is more urgent
  // than who published it.
  const own = center.type === "acopio" && isCommunity(center) ? communityIcon : normal;
  return isPaused(center) ? paused : own;
}

export function setCenters(entries: CenterEntry[]): number {
  const live = new Set(entries.map(({ data }) => data.id));
  for (const [id, { marker }] of centers) {
    if (live.has(id)) continue;
    // The point stopped existing: leaving its detail open would show something
    // the map no longer has.
    if (marker === selected) emit(null);
    centersLayer.removeLayer(marker);
    marker.remove();
    centers.delete(id);
    shareCards.delete(`c:${id}`);
  }

  for (const { data, mine } of entries) {
    const existing = centers.get(data.id);
    if (existing) {
      existing.data = data;
      const icon = centerIconFor(data);
      // `setIcon` rebuilds the marker element, so only when the drawing really
      // changed: doing it every time would drop the popup open on top.
      if (existing.marker.options.icon !== icon) existing.marker.setIcon(icon);
      const at = existing.marker.getLatLng();
      if (at.lat !== data.lat || at.lng !== data.lng)
        existing.marker.setLatLng([data.lat, data.lng]);
      attachPopup(existing.marker, centerPopupHtml(data, mine));
      // With the detail open, a pause or a change of hours has to show up right
      // there: the sheet does not find out on its own.
      if (existing.marker === selected) emit(existing.marker);
      continue;
    }

    const marker = L.marker([data.lat, data.lng], {
      icon: centerIconFor(data),
      zIndexOffset: -500,
    });
    attachPopup(marker, centerPopupHtml(data, mine));
    marker.on("click", selectOnMobile);
    centers.set(data.id, { data, marker });
  }

  return applyCenters();
}

export function startPicking(onPick: (latlng: L.LatLng) => void): void {
  claimView();
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
