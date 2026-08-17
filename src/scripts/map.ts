import L from "leaflet";
import {
  ZONE_DISCLAIMER,
  ZONE_FILL,
  type AffectedZone,
} from "@/scripts/affected-zones";
import type { ReportGroup } from "@/scripts/cluster";
import {
  isCommunity,
  isExpired,
  type Center,
  type CenterType,
} from "@/scripts/centers";
import { byCategory, categoryIdOf } from "@/scripts/resources";
import { readCachedCoords } from "@/scripts/geolocation";
import type { ShareCard } from "@/scripts/share-card";
import { markerEstado, statusInfo, type ReportStatus } from "@/scripts/status";
import { isMobile, onBreakpointChange } from "@/scripts/ui/breakpoint";
import { chipStyle, resourceChipHtml } from "@/components/ui/ResourceChip";
import { contactCtaHtml, contactLinksHtml } from "@/components/ui/ContactCta";
import {
  directionsUrl,
  escapeHtml,
  linkifyHtml,
  NAV_ICON,
  SHARE_ICON,
  stripUrls,
} from "@/scripts/ui/html";
import { statusSelectHtml } from "@/scripts/ui/status-select";
import { relativeTime } from "@/scripts/ui/time";

export const CALI_CENTER: [number, number] = [3.4516, -76.532];

/**
 * Valle del Cauca and Chocó together, corner to corner. It is the floor of «ver
 * toda la emergencia» and not its answer: what the button actually frames is
 * what is drawn — the municipality pins and the damage zones — and this only
 * takes over when none of that is on the map, so the button still moves and
 * still shows the region it names.
 *
 * It used to be Valle alone, and it has been widened twice by the same mistake:
 * first west and north for Chocó, where the epicentre was and where 29 of 31
 * municipalities were hit, then east for Risaralda and Caldas — Pereira sits at
 * −75.69 and Manizales at −75.52, both outside the old edge. Wide enough now to
 * hold Docordó on the Pacific, Quibdó in the north and Manizales in the east.
 *
 * Every widening has been a correction after the fact, which is the argument for
 * the function below framing what is drawn instead of trusting this rectangle.
 */
const EMERGENCY_BOUNDS: [[number, number], [number, number]] = [
  [3.0, -77.9],
  [8.8, -75.3],
];

/**
 * How close «ver toda la emergencia» is allowed to get. Fitting two municipality
 * pins that happen to be neighbours would otherwise fly the map down to a
 * street, and the whole request was to pull back.
 */
const EMERGENCY_MAX_ZOOM = 11;

/**
 * Farther out than this the map stops being a map of buildings and becomes a map
 * of towns: the report pins, the collection points and the damage circles all
 * leave, and the `municipio` pins — which are hidden at every closer zoom — take
 * their place. It is a swap and not a fade, because the two answer different
 * questions: at street zoom the question is which building needs what, and at
 * region zoom nothing below a whole municipality is legible anyway.
 *
 * Sitting one step above `EMERGENCY_MAX_ZOOM` is what makes «ver toda la
 * emergencia» land on the town side every time, and one step below the opening
 * view (13, or `USER_ZOOM` with a cached position) so the map never opens empty
 * of the detail it is for.
 */
const TOWNS_ONLY_MAX_ZOOM = 12;

let townsOnly = false;

const USER_ZOOM = 14;

/**
 * Whether something already decided what the map is looking at — a gesture, a
 * geocoded suggestion, a draft pin. From then on the initial view is nobody's
 * to set: the permission prompt can answer half a minute later and must not
 * pull the map away from what the person asked for.
 */
let viewClaimed = false;

/**
 * Group key -> its marker and the data it was drawn from. One marker per point,
 * never one per report. The group and its freshness are kept because the filter
 * runs outside the emission that brought them: without them, changing a filter
 * would only take effect on the next store tick, and a marker coming back into
 * the layer would come back without its `data-estado`.
 */
const markers = new Map<
  string,
  { marker: L.Marker; group: ReportGroup; extra: MarkerExtra }
>();

const keyByReport = new Map<string, string>();
let map: L.Map;
let pickHandler: ((latlng: L.LatLng) => void) | null = null;

const pulseIcon = L.divIcon({
  className: "pulse-marker",

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
  freshAt: string;

  lastUpdate?: string;
  stale: boolean;
};

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
  if (group.resources.length === 0)
    return `<p class="text-sm text-slate-500">Todavía no dice qué necesita.</p>`;

  const blocks = byCategory(group.resources, (resource) => resource.name).map(
    (bucket) => {
      const chips = bucket.items.map(resourceChipHtml).join(" ");
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

  const count = group.reports.length;
  const cuantos =
    count > 1
      ? `<p class="text-xs text-slate-500">${count} reportes en este punto</p>`
      : "";

  const fresh = `<p class="text-xs ${extra.stale ? "font-medium text-amber-700" : "text-slate-500"}">Actualizado ${escapeHtml(relativeTime(extra.freshAt))}${extra.stale ? " — confirma antes de ir" : ""}</p>`;

  const kicker = `
      ${statusSelectHtml(group.status, group.reportIds, lead.name)}
      ${fresh}`;

  const lugar = lead.placeName
    ? `<p class="text-base text-slate-600">${escapeHtml(lead.placeName)}</p>`
    : "";

  const lastUpdate = extra.lastUpdate
    ? `<p class="text-sm text-slate-600">«${escapeHtml(extra.lastUpdate)}»</p>`
    : "";

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

  const contacto = group.reports
    .filter((r) => r.contactName)
    .slice(0, 2)
    .map((r) => contactHtml(r.contactName as string, r.contactPhone))
    .join("");

  const shareKey = `r:${group.key}`;
  shareCards.set(shareKey, {
    kicker: statusInfo(group.status).label,
    accent: STATUS_ACCENT[group.status] ?? STATUS_ACCENT.activo,
    name: lead.name,

    address: lead.placeName,
    updated: `Actualizado ${relativeTime(extra.freshAt)}`,

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

/**
 * Lo que ve quien toca un marcador. Es el mismo HTML del popup: el sheet es otro
 * envase para el mismo contenido, no una segunda versión que mantener.
 */
export type MarkerSelection = { html: string; lat: number; lng: number };

/**
 * Lo que puede abrir detalle. Un marcador, y desde las zonas afectadas también
 * un círculo: las dos capas usan el mismo envase —popup en escritorio, sheet en
 * móvil— y una segunda mecánica de popup sería la misma idea dos veces.
 */
type DetailLayer = L.Marker | L.Circle;

let selectHandler: ((selection: MarkerSelection | null) => void) | null = null;
let selected: DetailLayer | null = null;

const popupHtml = new WeakMap<DetailLayer, string>();

export function onMarkerSelect(
  handler: (selection: MarkerSelection | null) => void,
): void {
  selectHandler = handler;
}

function emit(marker: DetailLayer | null): void {
  selected = marker;
  if (!marker) {
    selectHandler?.(null);
    return;
  }
  const { lat, lng } = marker.getLatLng();
  selectHandler?.({ html: popupHtml.get(marker) ?? "", lat, lng });
}

export function clearSelection(): void {
  selected = null;
}

/**
 * En móvil el marcador ni siquiera lleva popup: la burbuja de Leaflet queda
 * bajo el header y los botones flotantes, así que el detalle va al sheet. Atar
 * el popup y cerrarlo a mano dejaría un parpadeo en cada toque.
 */
function attachPopup(marker: DetailLayer, html: string): void {
  if (popupHtml.get(marker) === html) return;
  popupHtml.set(marker, html);
  if (isMobile()) marker.unbindPopup();
  else if (marker.getPopup()) marker.setPopupContent(html);
  else marker.bindPopup(html);
}

function selectOnMobile(event: L.LeafletMouseEvent): void {
  if (!isMobile()) return;
  emit(event.target as DetailLayer);
}

function syncPopupMode(): void {
  const all: DetailLayer[] = [
    ...[...markers.values()].map((report) => report.marker),
    ...[...centers.values()].map((center) => center.marker),
    ...zoneCircles,
  ];
  for (const marker of all) {
    const html = popupHtml.get(marker);
    if (html === undefined) continue;
    if (isMobile()) marker.unbindPopup();
    else if (!marker.getPopup()) marker.bindPopup(html);
  }
  if (isMobile()) map?.closePopup();
  else if (selected) emit(null);
}

export function initMap(containerId: string): L.Map {
  const cached = readCachedCoords();
  map = L.map(containerId, { zoomControl: false }).setView(
    cached ? [cached.lat, cached.lng] : CALI_CENTER,
    cached ? USER_ZOOM : 13,
  );

  L.tileLayer(
    "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
    {
      maxZoom: 20,
      subdomains: "abcd",

      updateWhenZooming: false,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    },
  ).addTo(map);

  L.control
    .zoom({
      position: "topright",
      zoomInTitle: "Acercar",
      zoomOutTitle: "Alejar",
    })
    .addTo(map);

  collapseAttribution(map);

  affectedLayer.addTo(map);
  centersLayer.addTo(map);
  reportsLayer.addTo(map);

  map.on("click", (event: L.LeafletMouseEvent) => {
    if (!pickHandler) return;
    const handler = pickHandler;
    stopPicking();
    handler(event.latlng);
  });

  const container = map.getContainer();
  map.on("movestart zoomstart", () => container.classList.add("is-moving"));
  map.on("moveend zoomend", () => container.classList.remove("is-moving"));

  const claim = () => claimView();
  for (const event of ["pointerdown", "wheel", "keydown"] as const) {
    container.addEventListener(event, claim, { once: true, passive: true });
  }

  const syncZoom = () => {
    const zoom = map.getZoom();
    const inRange = zoom <= ZONE_MAX_ZOOM;
    const towns = zoom <= TOWNS_ONLY_MAX_ZOOM;
    if (inRange === zonesInRange && towns === townsOnly) return;
    zonesInRange = inRange;
    if (towns !== townsOnly) {
      townsOnly = towns;
      applyReports();
      applyCenters();
    }
    applyZones();
  };
  syncZoom();
  map.on("zoomend", syncZoom);

  onBreakpointChange(syncPopupMode);

  return map;
}

/**
 * On a phone the credits are a bar along the whole bottom edge of the map. The
 * text itself is not optional — OSM and CARTO both require it — but reaching it
 * through an ⓘ is the standard mobile affordance, so the button goes in front of
 * it and the stylesheet only shows it below `lg`.
 *
 * The toggle lives inside Leaflet's own control instead of being one more
 * element in `index.astro`: the container is created by Leaflet and there is
 * nothing to move into the corner. `disableClickPropagation`, as in
 * `mountControl`, keeps the tap from dropping a pin while picking.
 */
function collapseAttribution(instance: L.Map): void {
  const container = instance.attributionControl?.getContainer();
  if (!container) return;

  const credits = document.createElement("span");
  credits.className = "attr-credits";
  credits.append(...container.childNodes);

  const card = document.createElement("div");
  card.className = "attr-card";
  card.innerHTML = `
    <p class="attr-people">
      Hecho por
      <a href="https:
        rel="noopener noreferrer">@panqueso.sanclemente</a>
      ,
      <a href="https:
        rel="noopener noreferrer">@manuu6450</a>
      y por la comunidad que reporta, confirma y mantiene al día cada punto del mapa 💚
    </p>`;
  card.append(credits);
  container.append(card);

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "attr-toggle";
  toggle.setAttribute("aria-label", "Créditos del mapa");
  toggle.setAttribute("aria-expanded", "false");
  toggle.innerHTML = `
    <svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor"
      stroke-width="1.6" stroke-linecap="round">
      <circle cx="10" cy="10" r="7"></circle>
      <path d="M10 9v4.5"></path>
      <path d="M10 6.5v.5"></path>
    </svg>`;
  container.prepend(toggle);

  L.DomEvent.disableClickPropagation(container);

  const setOpen = (open: boolean) => {
    container.classList.toggle("is-open", open);
    toggle.setAttribute("aria-expanded", String(open));
  };

  toggle.addEventListener("click", () => {
    setOpen(!container.classList.contains("is-open"));
  });
  instance.on("click movestart", () => setOpen(false));
}

/**
 * Mueve un elemento ya presente en la página a una esquina de Leaflet, para que
 * quede alineado con los controles del mapa sin repetir a mano dónde termina el
 * mapa: en móvil es la pantalla entera y en escritorio es la columna del medio.
 *
 * `disableClickPropagation` no es opcional: sin ella el clic sobre el botón le
 * llega también al mapa, y con el modo de marcar activo eso suelta un pin.
 */
export function mountControl(
  element: HTMLElement,
  position: L.ControlPosition = "topright",
): void {
  const Mounted = L.Control.extend({
    onAdd: () => {
      L.DomEvent.disableClickPropagation(element);
      L.DomEvent.disableScrollPropagation(element);
      return element;
    },
  });
  new Mounted({ position }).addTo(map);
}

export function refreshSize(): void {
  map?.invalidateSize();
}

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

    interactive: false,
    keyboard: false,
    zIndexOffset: -400,
  }).addTo(map);
}

export function flyToUser(): boolean {
  if (!meMarker) return false;
  const { lat, lng } = meMarker.getLatLng();

  void flyTo(lat, lng, Math.max(map.getZoom(), USER_ZOOM));
  return true;
}

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

  if (el.dataset.estado !== estado) el.dataset.estado = estado;
  el.classList.toggle("is-stale", extra.stale);
}

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

  dropShareCards("r:");

  for (const { group, extra } of entries) {
    for (const id of group.reportIds) keyByReport.set(id, group.key);

    const existing = markers.get(group.key);
    let marker: L.Marker;
    if (existing) {
      marker = existing.marker;
      existing.group = group;
      existing.extra = extra;

      const at = marker.getLatLng();
      if (at.lat !== group.lat || at.lng !== group.lng)
        marker.setLatLng([group.lat, group.lng]);
    } else {
      marker = L.marker([group.lat, group.lng], { icon: pulseIcon });
      marker.on("click", selectOnMobile);
      markers.set(group.key, { marker, group, extra });
    }

    attachPopup(marker, reportPopupHtml(group, extra));
    paintEstado(marker, group, extra);

    if (marker === selected) emit(marker);
  }

  const live = new Set(entries.map(({ group }) => group.key));
  for (const key of [...markers.keys()]) if (!live.has(key)) dropMarker(key);

  applyReports();
}

function dropMarker(key: string): void {
  const entry = markers.get(key);
  if (!entry) return;
  markers.delete(key);

  if (entry.marker === selected) emit(null);
  forgetFade(entry.marker);
  reportsLayer.removeLayer(entry.marker);
  entry.marker.remove();
}

export function markerKeyForReport(id: string): string | undefined {
  return keyByReport.get(id);
}

/**
 * Inner wrapper of the marker holding this report — safe to animate, unlike the
 * positioned root.
 */
export function getMarkerElement(id: string): HTMLElement | undefined {
  const key = keyByReport.get(id);
  const el = key ? markers.get(key)?.marker.getElement() : undefined;
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

/**
 * Pulls back until the whole emergency fits in the frame.
 *
 * What it frames is what is drawn and not a fixed rectangle: the municipality
 * pins and the damage zones, which are the two layers that answer «where is this
 * bad». That is also what keeps it honest as the emergency moves — the pins
 * reached into Chocó and the button followed them with nothing to change here.
 * A fixed rectangle would still be showing Valle. `EMERGENCY_BOUNDS` is the
 * floor for the one case the layers cannot answer — nothing drawn at all — so
 * the button still moves and still shows the region it promised.
 *
 * The circles go in whole (`getBounds()`) and not as their centres: a zone is
 * its radius, and half of one hanging off the edge would be the button failing
 * at its one job.
 */
export function flyToEmergency(reserveTop = 0): Promise<void> {
  claimView();
  const bounds = L.latLngBounds([]);
  for (const { data, marker } of centers.values())
    if (data.type === "municipio") bounds.extend(marker.getLatLng());
  for (const circle of zoneCircles) bounds.extend(circle.getBounds());

  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      map.off("moveend", finish);
      resolve();
    };

    const timer = setTimeout(finish, 1500);
    map.once("moveend", () => {
      clearTimeout(timer);
      finish();
    });

    map.flyToBounds(
      bounds.isValid() ? bounds : L.latLngBounds(EMERGENCY_BOUNDS),
      {
        paddingTopLeft: [48, 48 + Math.max(reserveTop, 0)],
        paddingBottomRight: [48, 48],
        maxZoom: EMERGENCY_MAX_ZOOM,
        duration: 1.2,
      },
    );
  });
}

/**
 * How long a pin takes to go, and it is the CSS that runs it — the rules for
 * `.leaflet-marker-icon` and `.affected-zone` in `global.css` carry the same
 * number. Here it is only the wait before the layer drops what is already
 * invisible: taking the marker out at once would cut the transition on its first
 * frame, and leaving it in forever would keep a hidden pin catching clicks.
 */
const FADE_MS = 220;

const ZONE_FILL_OPACITY = 0.14;

/**
 * Pending removals. One per layer, so a pin asked to come back while it is
 * still fading out cancels its own exit instead of vanishing a moment later.
 */
const fadeTimers = new Map<L.Layer, number>();

function setFillOpacity(layer: L.Marker | L.Circle, opacity: number): void {
  if (layer instanceof L.Circle) layer.setStyle({ fillOpacity: opacity });
  else layer.setOpacity(opacity);
}

/**
 * Adds or removes with the fade, and it is the one door into every layer group
 * on this map: the zoom swap, the filter and the reconciliations all go through
 * here, so nothing can appear at full opacity by accident.
 *
 * Coming in, the opacity is written before the layer is added and raised on the
 * next frame — a node inserted and restyled in the same one transitions from
 * nothing.
 */
function setLayerVisible(
  group: L.LayerGroup,
  layer: L.Marker | L.Circle,
  visible: boolean,
): void {
  const pending = fadeTimers.get(layer);
  if (pending !== undefined) {
    clearTimeout(pending);
    fadeTimers.delete(layer);
  }

  const full = layer instanceof L.Circle ? ZONE_FILL_OPACITY : 1;

  if (visible) {
    if (group.hasLayer(layer)) {
      setFillOpacity(layer, full);
      return;
    }
    setFillOpacity(layer, 0);
    group.addLayer(layer);
    requestAnimationFrame(() => {
      if (!group.hasLayer(layer) || fadeTimers.has(layer)) return;
      setFillOpacity(layer, full);
    });
    return;
  }

  if (!group.hasLayer(layer)) return;
  setFillOpacity(layer, 0);
  fadeTimers.set(
    layer,
    window.setTimeout(() => {
      fadeTimers.delete(layer);
      group.removeLayer(layer);
    }, FADE_MS),
  );
}

/**
 * The layer is going away for good — the row stopped existing, or the whole zone
 * list is being replaced. No fade: what leaves here is not coming back, and the
 * pending removal has to go with it or it would fire over a dead marker.
 */
function forgetFade(layer: L.Marker | L.Circle): void {
  const pending = fadeTimers.get(layer);
  if (pending === undefined) return;
  clearTimeout(pending);
  fadeTimers.delete(layer);
}

/**
 * Report markers used to hang straight off the map. They live in a layer now for
 * the same reason the centers do: the filter has to be able to take them out
 * without touching anything else, and putting them back has to leave the popup
 * that was open on a neighbour alone.
 */
const reportsLayer = L.layerGroup();

let reportsVisible = true;
let reportsOnlyRecent = false;

/**
 * Qué reportes deja ver el filtro del mapa. `onlyRecent` usa la misma frescura
 * que pinta la tarjeta y el punto ámbar del marcador (`extra.stale`): el mapa y
 * la lista no pueden discrepar sobre qué tan viejo es un punto.
 */
export function setReportVisibility(
  visible: boolean,
  onlyRecent: boolean,
): number {
  reportsVisible = visible;
  reportsOnlyRecent = onlyRecent;
  return applyReports();
}

/**
 * Puts the reports that pass the filter in the layer and takes the rest out.
 * Marker by marker, like `applyCenters` and for the same reason. Returns how
 * many stayed visible.
 */
function applyReports(): number {
  let shown = 0;
  let closes = false;
  for (const { marker, group, extra } of markers.values()) {
    const visible =
      !townsOnly && reportsVisible && (!reportsOnlyRecent || !extra.stale);
    if (visible) shown += 1;
    else if (marker === selected) closes = true;
    const entering = visible && !reportsLayer.hasLayer(marker);
    setLayerVisible(reportsLayer, marker, visible);

    if (entering) paintEstado(marker, group, extra);
  }
  if (closes) emit(null);
  return shown;
}

const centersLayer = L.layerGroup();
/**
 * Center -> its marker, by id. A registry and not a list that gets rebuilt,
 * because the marker has to survive the emission: anyone can register a
 * collection point anywhere in the city, that arrives over realtime, and
 * rebuilding the whole layer closed the detail somebody was reading of another
 * point. Reconciled like the reports: create, refresh or drop.
 */
const centers = new Map<string, { data: Center; marker: L.Marker }>();

const ALL_CENTER_TYPES: CenterType[] = [
  "acopio",
  "albergue",
  "sangre",
  "healthcare",
];

let visibleCenterTypes = new Set<CenterType>(ALL_CENTER_TYPES);
let centersOnlyActive = false;

/**
 * Qué puntos deja ver el filtro del mapa: los tipos marcados, y con
 * `onlyActive`, solo los que hoy cuentan como abiertos — el mismo `isPaused` que
 * ya decide si el cuadrito va gris.
 */
export function setCenterVisibility(
  types: Set<CenterType>,
  onlyActive: boolean,
): number {
  visibleCenterTypes = new Set(types);
  centersOnlyActive = onlyActive;
  return applyCenters();
}

const collectionIcon = L.divIcon({
  className: "center-marker",
  html: '<span class="center-pin"></span>',
  iconSize: [16, 16],
  iconAnchor: [8, 8],
  popupAnchor: [0, -10],
});

const communityIcon = L.divIcon({
  className: "center-marker",
  html: '<span class="center-pin" data-community></span>',
  iconSize: [16, 16],
  iconAnchor: [8, 8],
  popupAnchor: [0, -10],
});

const collectionPausedIcon = L.divIcon({
  className: "center-marker",
  html: '<span class="center-pin" data-paused></span>',
  iconSize: [16, 16],
  iconAnchor: [8, 8],
  popupAnchor: [0, -10],
});

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

const municipioIcon = L.divIcon({
  className: "municipio-marker",
  html: '<span class="municipio-pin"></span>',
  iconSize: [22, 22],
  iconAnchor: [11, 11],
  popupAnchor: [0, -13],
});

const municipioPausedIcon = L.divIcon({
  className: "municipio-marker",
  html: '<span class="municipio-pin" data-paused></span>',
  iconSize: [22, 22],
  iconAnchor: [11, 11],
  popupAnchor: [0, -13],
});

const ICON: Record<Center["type"], { normal: L.DivIcon; paused: L.DivIcon }> = {
  acopio: { normal: collectionIcon, paused: collectionPausedIcon },
  sangre: { normal: bloodIcon, paused: bloodPausedIcon },
  albergue: { normal: shelterIcon, paused: shelterPausedIcon },
  healthcare: { normal: healthcareIcon, paused: healthcarePausedIcon },
  municipio: { normal: municipioIcon, paused: municipioPausedIcon },
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
const KICKER: Record<
  Center["type"],
  { label: string; color: string; accent: string }
> = {
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
    label: "Atención en salud",
    color: "text-blue-700",
    accent: "#1d4ed8",
  },
  municipio: {
    label: "Municipio que pide ayuda",
    color: "text-red-800",
    accent: "#991b1b",
  },
};

/**
 * The title over the chips. Every other type lists what it takes in; a
 * municipality lists what it is short of, and calling that «Recibe» would read
 * as an invitation to drive supplies to a town square that may not have one.
 */
function chipsTitleFor(center: Center): string {
  return center.type === "municipio" ? "Necesita" : "Recibe";
}

/**
 * What a point takes, a chip per supply and the category as a title — the same
 * build as `resourcesHtml`. What the point listed are those supplies and not
 * the whole category, so the chip has to be the supply: it is the only thing
 * that compares at a glance against a report's chips.
 */
function donationsHtml(center: Center, paused: boolean): string {
  if (center.donations.length === 0) return "";
  const blocks = byCategory(center.donations, (item) => item).map((bucket) => {
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

  return `
    <div class="space-y-2">
      <p class="text-xs m-0 font-semibold uppercase tracking-wide text-slate-500">${escapeHtml(chipsTitleFor(center))}</p>
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

  const expired = center.isActive && isExpired(center);
  const donations = donationsHtml(center, paused);
  const contact = contactLinksHtml(
    center.contactWhatsapp,
    center.contactInstagram,
  );

  const notes = center.notes
    ? `<p class="text-sm wrap-break-word text-slate-500">${
        isCommunity(center)
          ? escapeHtml(center.notes)
          : linkifyHtml(center.notes)
      }</p>`
    : "";

  const { label, color, accent } = KICKER[center.type];
  const kickerLabel = expired
    ? `${label} · Sin confirmar`
    : paused
      ? `${label} · Cerrado por ahora`
      : label;
  const kicker = paused
    ? `<p class="text-xs font-semibold uppercase tracking-wide text-slate-500">${kickerLabel}</p>`
    : `<p class="text-xs font-semibold uppercase tracking-wide ${color}">${label}</p>`;

  const notAcceptingLabel =
    center.type === "sangre"
      ? "No recibe donantes por ahora"
      : "No recibe donaciones por ahora";

  const notAccepting = center.acceptingDonations
    ? ""
    : `<p class="text-xs font-medium text-amber-700">${notAcceptingLabel}</p>`;

  const notice = expired
    ? `<p
        class="text-xs font-medium text-amber-700"
        data-time="${escapeHtml(center.updatedAt)}"
        data-time-prefix="${CONFIRM_PREFIX}"
      >${CONFIRM_PREFIX}${relativeTime(center.updatedAt)}</p>`
    : paused
      ? `<p class="text-xs font-medium text-amber-700">Cerrado por ahora</p>`
      : "";

  const ctaClass = paused
    ? "center-cta center-cta-quiet flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-4 py-2 text-md font-semibold no-underline transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-slate-300"
    : "center-cta flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-md font-semibold no-underline shadow-sm transition hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-300";
  const origin = `<p class="text-sm text-slate-500">${ORIGIN[center.origin]}</p>`;

  const remove =
    mine && isCommunity(center)
      ? `<button
        type="button"
        data-delete-center="${escapeHtml(center.id)}"
        data-point-name="${escapeHtml(center.name)}"
        class="mt-1 w-full text-xs font-medium text-slate-400 transition hover:text-red-600"
      >Eliminar este punto</button>`
      : "";

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

      expired
        ? "Sin confirmar recientemente"
        : paused
          ? "Cerrado por ahora"
          : "",
      center.acceptingDonations ? "" : notAcceptingLabel,
      center.contactWhatsapp ? `WhatsApp ${center.contactWhatsapp}` : "",
      center.contactInstagram ? `Instagram @${center.contactInstagram}` : "",
      ORIGIN[center.origin],
    ].filter(Boolean),

    notes: [center.notes]
      .map((note) => (note ? stripUrls(note) : ""))
      .filter(Boolean),
    chipsTitle: chipsTitleFor(center),
    chips: center.donations.map((item) => ({
      label: item,
      category: categoryIdOf(item) ?? null,
      muted: paused,
    })),
    marker: "square",
    lat: center.lat,
    lng: center.lng,
  });

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

function matchesFilter(center: Center): boolean {
  if (townsOnly !== (center.type === "municipio")) return false;
  if (!visibleCenterTypes.has(center.type)) return false;
  return !centersOnlyActive || !isPaused(center);
}

/**
 * Puts the ones that pass the filter in the layer and takes the rest out.
 * Marker by marker and not with `clearLayers()`: emptying the whole layer rips
 * out of the DOM the ones about to be added back in the same pass, and with
 * them the popup open on top. Returns how many stayed visible.
 */
function applyCenters(): number {
  let shown = 0;
  let closes = false;
  for (const { data, marker } of centers.values()) {
    const visible = matchesFilter(data);
    if (visible) shown += 1;
    else if (marker === selected) closes = true;
    setLayerVisible(centersLayer, marker, visible);
  }
  if (closes) emit(null);
  return shown;
}

/**
 * The icon a point gets. Chosen on every emission and not once: greying a point
 * out in Supabase arrives as a new row over the same id, and the marker stays —
 * what changes is the drawing.
 */
function centerIconFor(center: Center): L.DivIcon {
  const { normal, paused } = ICON[center.type];

  const own =
    center.type === "acopio" && isCommunity(center) ? communityIcon : normal;
  return isPaused(center) ? paused : own;
}

export function setCenters(entries: CenterEntry[]): number {
  const live = new Set(entries.map(({ data }) => data.id));
  for (const [id, { marker }] of centers) {
    if (live.has(id)) continue;

    if (marker === selected) emit(null);
    forgetFade(marker);
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

      if (existing.marker.options.icon !== icon) existing.marker.setIcon(icon);
      const at = existing.marker.getLatLng();
      if (at.lat !== data.lat || at.lng !== data.lng)
        existing.marker.setLatLng([data.lat, data.lng]);
      attachPopup(existing.marker, centerPopupHtml(data, mine));

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

const affectedLayer = L.layerGroup();
const zoneCircles: L.Circle[] = [];
let zonesVisible = true;

/**
 * Más cerca que esto la capa se apaga, y no es solo por cuadros por segundo.
 *
 * Una zona es una afirmación a escala de ciudad —«por acá hubo reportes»—, y a
 * zoom de calle una mancha sobre cuatro cuadras se empieza a leer como algo
 * dicho de los edificios que quedan debajo, que es justo lo que la fuente pide
 * no leer. Lo otro es el costo: el desenfoque es un filtro SVG, su superficie
 * crece con el zoom, y a 20 el círculo más grande pasa de 6.000 px de radio.
 */
const ZONE_MAX_ZOOM = 17;

let zonesInRange = true;

/**
 * Cuántos reportes y de qué tipo, sin nombrar una sola dirección. El colapso se
 * cuenta aparte porque es la única distinción que la fuente hace, y va como
 * conteo y no como color: pintar dos intensidades sería insinuar una gradación
 * de daño que estos datos no miden.
 */
function affectedPopupHtml(zone: AffectedZone): string {
  const reports = `${zone.reports} ${zone.reports === 1 ? "reporte" : "reportes"}`;
  const collapses =
    zone.collapses > 0 ? `, ${zone.collapses} de ellos por colapso` : "";
  const warnings = ZONE_DISCLAIMER.map(
    (line) => `<li>${escapeHtml(line)}</li>`,
  ).join("");
  return `
    <div class="space-y-2">
      <div class="space-y-1">
        <p class="text-xs font-semibold uppercase tracking-wide text-orange-700">Zona con reportes de daño</p>
        <p class="text-lg font-semibold leading-tight text-slate-900 mt-3">${escapeHtml(zone.label)}</p>
        <p class="text-sm text-slate-600">${reports}${collapses}</p>
      </div>
      <ul class="m-0 list-disc space-y-1 pl-4 text-xs text-slate-500">${warnings}</ul>
    </div>`;
}

/**
 * Reemplaza la capa entera. Acá sí se puede vaciar de golpe, al revés que en
 * `applyCenters`: son datos estáticos que llegan una sola vez, así que no hay
 * un repintado que pueda arrancar de debajo el detalle que alguien esté
 * leyendo.
 */
export function setAffectedZones(zones: AffectedZone[]): void {
  if (selected && isZoneCircle(selected)) emit(null);
  for (const circle of zoneCircles) forgetFade(circle);
  affectedLayer.clearLayers();
  zoneCircles.length = 0;

  for (const zone of zones) {
    const circle = L.circle([zone.lat, zone.lng], {
      radius: zone.radius,
      className: "affected-zone",
      stroke: false,
      fillColor: ZONE_FILL,
      fillOpacity: ZONE_FILL_OPACITY,
    });
    attachPopup(circle, affectedPopupHtml(zone));
    circle.on("click", onZoneClick);
    zoneCircles.push(circle);
  }

  applyZones();
}

/**
 * Un marcador ocupa 18 píxeles y una zona media ciudad: mientras se elige un
 * punto en el mapa, el clic tiene que atravesarla. Sin esto la capa se traga el
 * gesto justo en las cuadras donde más se va a reportar.
 */
function onZoneClick(event: L.LeafletMouseEvent): void {
  if (!pickHandler) {
    selectOnMobile(event);
    return;
  }
  const handler = pickHandler;
  stopPicking();
  (event.target as L.Circle).closePopup();
  handler(event.latlng);
}

function isZoneCircle(layer: DetailLayer): boolean {
  return zoneCircles.some((circle) => circle === layer);
}

export function setAffectedVisibility(visible: boolean): number {
  zonesVisible = visible;
  return applyZones();
}

function applyZones(): number {
  const visible = zonesVisible && zonesInRange && !townsOnly;
  for (const circle of zoneCircles)
    setLayerVisible(affectedLayer, circle, visible);
  if (!visible && selected && isZoneCircle(selected)) emit(null);
  return visible ? zoneCircles.length : 0;
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
