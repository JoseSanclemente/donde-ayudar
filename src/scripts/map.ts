import L from "leaflet";
import type { ReportGroup } from "./cluster";
import { esComunitario, recibeInsumos, type Centro } from "./centros";
import {
  ALBERGUE_FILTER,
  byCategory,
  categoryIdOf,
  SANGRE_FILTER,
} from "./resources";
import { readCachedCoords } from "./geolocation";
import { markerEstado, statusInfo } from "./status";
import { isMobile, onBreakpointChange } from "./ui/breakpoint";
import { chipLabel, chipStyle } from "./ui/chips";
import { telUrl, whatsappUrl } from "./ui/contact";
import { directionsUrl, escapeHtml, NAV_ICON } from "./ui/html";
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

/** Bloque de contacto del popup: nombre en texto y, si hay número, CTA a WhatsApp. */
function contactHtml(name: string, phone: string | null): string {
  const who = `<p class="text-sm text-slate-600">Contacto: ${escapeHtml(name)}</p>`;
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

  // El estado encabeza el popup: antes de saber qué falta hay que saber si se
  // puede llegar. Va como selector y no como chip de lectura porque cambiarlo es
  // comunitario, y quien está parado frente al punto es quien lo sabe — el chip
  // solo le dejaba la opción de ir a buscar la fila en la lista. El aviso
  // («no te desplaces») queda debajo: la etiqueta del `<option>` nombra el
  // estado, no dice qué hacer con él.
  const kicker = `
      ${statusSelectHtml(group.status, group.reportIds, lead.name)}
      <p class="text-xs text-slate-500">${escapeHtml(statusInfo(group.status).aviso)}</p>`;

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
    .map(
      (r) =>
        `<p class="text-sm leading-snug text-slate-600">“${escapeHtml(r.note as string)}”</p>`,
    )
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
      <p class="text-lg font-semibold text-slate-900">${escapeHtml(lead.name)}</p>
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

export function flyTo(lat: number, lng: number, zoom = 17): Promise<void> {
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

// Registrado por la comunidad: el mismo cuadrado, un indigo más claro. Quién lo
// publicó no cambia qué es el punto, así que tampoco cambia la forma — un tercer
// contorno se leería como un cuarto tipo. Lo que sí lo dice con todas sus letras
// es el popup, y ahí se etiquetan los dos orígenes.
const comunidadIcon = L.divIcon({
  className: "centro-marker",
  html: '<span class="centro-pin" data-comunidad></span>',
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

const sangrePausaIcon = L.divIcon({
  className: "sangre-marker",
  html: '<span class="sangre-pin" data-pausa></span>',
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

/** Icono por tipo con su variante en pausa. */
const ICON: Record<Centro["tipo"], { normal: L.DivIcon; pausa?: L.DivIcon }> = {
  acopio: { normal: centroIcon, pausa: pausaIcon },
  sangre: { normal: sangreIcon, pausa: sangrePausaIcon },
  albergue: { normal: albergueIcon, pausa: alberguePausaIcon },
};

/** Un punto que sigue abierto y hoy no recibe. */
function enPausa(centro: Centro): boolean {
  return !centro.recibiendo;
}

/**
 * Quién publicó el punto. Se etiquetan los dos orígenes y no solo el
 * comunitario: «creado por la comunidad» no dice nada si lo otro va sin marcar,
 * y la pregunta que resuelve —¿esto lo verificó alguien?— necesita las dos
 * respuestas a la vista.
 */
const ORIGEN: Record<Centro["origen"], string> = {
  curado: "Creado por la alcaldía",
  comunidad: "Creado por la comunidad",
};

/** Etiqueta y color del kicker por tipo. Un cuarto tipo es una entrada más. */
const KICKER: Record<Centro["tipo"], { label: string; color: string }> = {
  acopio: { label: "Centro de acopio", color: "text-indigo-700" },
  sangre: { label: "Banco de sangre", color: "text-rose-700" },
  albergue: { label: "Albergue", color: "text-amber-700" },
};

/**
 * Lo que recibe un punto, con un chip por insumo y la categoría de título —el
 * mismo armado de `resourcesHtml`. Lo que el punto listó son esos insumos y no
 * la categoría entera, así que el chip tiene que ser el insumo: es lo único que
 * se puede comparar de un vistazo contra los chips de un reporte.
 */
function recibeHtml(centro: Centro, pausa: boolean): string {
  if (!recibeInsumos(centro)) return "";
  const blocks = byCategory(centro.recibe, (item) => item).map((bucket) => {
    // En pausa los chips van tachados, con el mismo gris de un recurso ya
    // cubierto: sigue siendo lo que ese centro recibe, pero no ahora. Sin el
    // «✓» de `chipLabel`, eso sí: acá no hay nada cubierto.
    const chips = bucket.items
      .map(
        (item) =>
          `<span class="inline-block ${chipStyle(item, pausa)}">${escapeHtml(item)}</span>`,
      )
      .join(" ");
    return `
      <div>
        <p class="text-[11px] font-semibold uppercase tracking-wide text-slate-500">${escapeHtml(bucket.label)}</p>
        <div class="mt-1 flex flex-wrap gap-1">${chips}</div>
      </div>`;
  });
  // Con el detalle debajo, los chips dejaron de leerse solos: sin este título
  // parecen lo que el punto necesita, no lo que entrega quien va.
  return `
    <div class="space-y-2">
      <p class="text-xs m-0 font-semibold uppercase tracking-wide text-slate-500">Recibe</p>
      ${blocks.join("")}
    </div>`;
}

/**
 * Un punto y si es de quien está mirando. Igual que `MarkerExtra`: lo que no
 * vive en la fila entra por parámetro, para que `map.ts` no tenga que importar
 * los stores. Quien lo calcula es `features/centros-layer.ts`.
 */
export type CentroEntry = { data: Centro; mine: boolean };

function centroPopupHtml(centro: Centro, mine: boolean): string {
  const pausa = enPausa(centro);
  const recibe = recibeHtml(centro, pausa);
  const telefono = centro.telefono
    ? `<p class="text-sm text-slate-600">Tel. ${escapeHtml(centro.telefono)}</p>`
    : "";
  const notas = centro.notas
    ? `<p class="text-sm text-slate-500">${escapeHtml(centro.notas)}</p>`
    : "";
  // El estado va en el kicker y no solo en el color del pin: quien abre el popup
  // tiene que leerlo antes que la dirección.
  const { label, color } = KICKER[centro.tipo];
  const kicker = pausa
    ? `<p class="text-xs font-semibold uppercase tracking-wide text-slate-500">${label} · No recibe por ahora</p>`
    : `<p class="text-xs font-semibold uppercase tracking-wide ${color}">${label}</p>`;
  const notaEstado = centro.nota_estado
    ? `<p class="text-sm text-slate-600">${escapeHtml(centro.nota_estado)}</p>`
    : "";
  // Un banco de sangre no recibe insumos sino donantes: decirle «donaciones» a
  // secas deja pensando si la puerta sigue abierta para donar sangre.
  const avisoLabel =
    centro.tipo === "sangre"
      ? "No recibe donantes por ahora"
      : "No recibe donaciones por ahora";
  // Mismo ámbar que el aviso de un reporte viejo: "existe, pero no te desplaces".
  const aviso = pausa
    ? `<p class="text-xs font-medium text-amber-700">${avisoLabel}</p>${notaEstado}`
    : "";
  // En pausa el CTA deja de ser el azul sólido: sigue disponible para quien
  // quiera ubicarlo, pero no invita al viaje.
  const ctaClass = pausa
    ? "centro-cta centro-cta-quiet mt-1 flex w-full items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-4 py-2 text-md font-semibold no-underline transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-slate-300"
    : "centro-cta mt-1 flex w-full items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-md font-semibold no-underline shadow-sm transition hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-300";
  const origen = `<p class="text-sm text-slate-500">${ORIGEN[centro.origen]}</p>`;
  // Las dos condiciones de la policy de delete, y por eso las dos acá: ofrecer
  // el botón sobre un punto curado sería ofrecer algo que el servidor rechaza.
  // Va al final y en gris: se busca cuando se necesita, no compite con «Cómo
  // llegar», que es a lo que viene todo el mundo.
  const borrar =
    mine && esComunitario(centro)
      ? `<button
        type="button"
        data-delete-centro="${escapeHtml(centro.id)}"
        data-point-name="${escapeHtml(centro.name)}"
        class="mt-1 w-full text-xs font-medium text-slate-400 transition hover:text-red-600"
      >Eliminar este punto</button>`
      : "";
  // Nombre, quién lo publicó y dónde queda son la misma respuesta —«qué es esto
  // y dónde está»—, así que van pegados en un bloque y el resto respira aparte.
  return `
    <div class="space-y-2">
      <div class="space-y-1">
        ${kicker}
        <p class="text-lg font-semibold leading-tight text-slate-900 mt-3">${escapeHtml(centro.name)}</p>
        ${origen}
        <p data-address class="text-xs text-slate-600">${escapeHtml(centro.direccion)}</p>
      </div>
      ${aviso}
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
      ${borrar}
    </div>`;
}

// `SANGRE_FILTER` y `ALBERGUE_FILTER` son valores reservados del filtro, no ids de
// `CATEGORIES`: filtran por tipo de punto, mientras que los demás filtran por qué
// se recibe — y por eso alcanzan a acopios y albergues por igual.
function matchesFilter(centro: Centro): boolean {
  if (centroFilter === null) return true;
  if (centroFilter === SANGRE_FILTER) return centro.tipo === "sangre";
  if (centroFilter === ALBERGUE_FILTER) return centro.tipo === "albergue";
  return (
    recibeInsumos(centro) &&
    centro.recibe.some((item) => categoryIdOf(item) === centroFilter)
  );
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
  const openCentro =
    selected !== null && centros.some(({ marker }) => marker === selected);
  if (openCentro && !centrosLayer.hasLayer(selected as L.Marker)) emit(null);
  return shown;
}

export function setCentros(entries: CentroEntry[]): number {
  // La lista se reconstruye entera: los marcadores viejos —y con ellos el que
  // estuviera abierto— dejan de existir. Es también lo que cierra el detalle de
  // un punto recién borrado, sin que el borrado tenga que saber del panel.
  if (selected && centros.some(({ marker }) => marker === selected)) emit(null);
  centros.length = 0;
  for (const { data, mine } of entries) {
    // The icon is picked here and never repainted afterwards, unlike
    // `paintEstado` for reports. It does not have to be: pausing a point in
    // Supabase re-emits the whole list and this function rebuilds every marker
    // from scratch, so the new state arrives as a new icon.
    const { normal, pausa } = ICON[data.tipo];
    // Solo el acopio tiene variante comunitaria: es el único tipo que registra
    // el formulario. La pausa gana sobre el origen — gris con barras dice «hoy no
    // vayas», que es más urgente que quién lo publicó.
    const suyo =
      data.tipo === "acopio" && esComunitario(data) ? comunidadIcon : normal;
    const icon = enPausa(data) && pausa ? pausa : suyo;
    const marker = L.marker([data.lat, data.lng], {
      icon,
      zIndexOffset: -500,
    });
    attachPopup(marker, centroPopupHtml(data, mine));
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
