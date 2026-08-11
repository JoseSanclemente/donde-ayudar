import L from "leaflet";
import type { Report } from "./store";
import type { Centro } from "./centros";
import {
  categoryChip,
  categoryLabel,
  chipClass,
  COVERED_CHIP,
  SANGRE_FILTER,
} from "./resources";

export const CALI_CENTER: [number, number] = [3.4516, -76.532];

const markers = new Map<string, L.Marker>();
let map: L.Map;
let pickHandler: ((latlng: L.LatLng) => void) | null = null;

const pulseIcon = L.divIcon({
  className: "pulse-marker",
  // The outer marker element carries Leaflet's positioning transform, so the
  // inner wrapper is what GSAP animates — otherwise the two fight over it.
  html: '<span class="pulse-inner"><span class="pulse-ring"></span><span class="pulse-dot"></span></span>',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
  popupAnchor: [0, -12],
});

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c] as string,
  );
}

// Flecha de navegación, inline porque el popup se arma como string y no puede
// depender de un componente. `currentColor` hereda el texto del botón.
const NAV_ICON = `<svg class="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M21.4 2.6a1 1 0 0 0-1.1-.2l-17 7.4a1 1 0 0 0 .1 1.9l7.1 2.1 2.1 7.1a1 1 0 0 0 1.9.1l7.4-17a1 1 0 0 0-.5-1.4Z"/></svg>`;

/**
 * Ruta en Google Maps hasta el punto exacto. Va por coordenadas y no por nombre
 * porque varias direcciones curadas son aproximadas ("Torre 2 piso 4") y una
 * búsqueda por texto aterrizaría en otra parte.
 */
function directionsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
}

function isCovered(report: Report, resource: string): boolean {
  return report.covered.includes(resource);
}

function allCovered(report: Report): boolean {
  return report.resources.length > 0 && report.resources.every((r) => isCovered(report, r));
}

function popupHtml(report: Report): string {
  const pending = report.resources.filter((r) => !isCovered(report, r));
  const covered = report.resources.filter((r) => isCovered(report, r));
  const chips = [...pending, ...covered]
    .map((r) => {
      const done = isCovered(report, r);
      const style = done ? COVERED_CHIP : chipClass(r);
      const label = `${done ? "✓ " : ""}${escapeHtml(r)}`;
      return `<span class="inline-block rounded-full px-2 py-0.5 text-xs font-medium ${style}">${label}</span>`;
    })
    .join(" ");
  const date = new Date(report.createdAt).toLocaleString("es-CO", {
    dateStyle: "medium",
    timeStyle: "short",
  });
  const resolved = allCovered(report)
    ? '<p class="text-xs font-medium text-emerald-700">Necesidades cubiertas</p>'
    : "";
  return `
    <div class="space-y-2">
      <p class="text-sm font-semibold text-slate-900">${escapeHtml(report.name)}</p>
      <div class="flex flex-wrap gap-1">${chips}</div>
      ${resolved}
      <p class="text-xs text-slate-500">Reportado el ${escapeHtml(date)}</p>
    </div>`;
}

export function initMap(containerId: string): L.Map {
  map = L.map(containerId, { zoomControl: true }).setView(CALI_CENTER, 13);

  // Positron: OSM data, minimal gray-on-white render — no POI icons, sparse
  // labels — so the red report markers are the only saturated thing on screen.
  L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
    maxZoom: 20,
    subdomains: "abcd",
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

export function addMarker(report: Report): L.Marker {
  const marker = L.marker([report.lat, report.lng], { icon: pulseIcon })
    .addTo(map)
    .bindPopup(popupHtml(report));
  markers.set(report.id, marker);
  return marker;
}

/** Refresca el popup y apaga el marcador cuando la zona ya está cubierta. */
export function updateMarker(report: Report): void {
  const marker = markers.get(report.id);
  if (!marker) return;
  marker.setPopupContent(popupHtml(report));
  marker.getElement()?.classList.toggle("is-covered", allCovered(report));
}

/** Inner wrapper of a marker — safe to animate, unlike the positioned root. */
export function getMarkerElement(id: string): HTMLElement | undefined {
  const el = markers.get(id)?.getElement();
  return (el?.querySelector(".pulse-inner") as HTMLElement | null) ?? undefined;
}

export function removeMarker(id: string): L.Marker | undefined {
  const marker = markers.get(id);
  if (!marker) return undefined;
  markers.delete(id);
  return marker;
}

export function detachMarker(marker: L.Marker): void {
  marker.remove();
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

const sangreIcon = L.divIcon({
  className: "sangre-marker",
  html: '<span class="sangre-pin"></span>',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
  popupAnchor: [0, -11],
});

function centroPopupHtml(centro: Centro): string {
  const sangre = centro.tipo === "sangre";
  const chips = sangre
    ? ""
    : centro.recibe
        .map(
          (id) =>
            `<span class="inline-block rounded-full px-2 py-0.5 text-xs font-medium ${categoryChip(
              id,
            )}">${escapeHtml(categoryLabel(id))}</span>`,
        )
        .join(" ");
  const telefono = centro.telefono
    ? `<p class="text-xs text-slate-600">Tel. ${escapeHtml(centro.telefono)}</p>`
    : "";
  const notas = centro.notas
    ? `<p class="text-xs text-slate-500">${escapeHtml(centro.notas)}</p>`
    : "";
  const kicker = sangre
    ? '<p class="text-xs font-semibold uppercase tracking-wide text-rose-700">Banco de sangre</p>'
    : '<p class="text-xs font-semibold uppercase tracking-wide text-indigo-700">Centro de acopio</p>';
  return `
    <div class="space-y-2">
      ${kicker}
      <p class="text-sm font-semibold text-slate-900">${escapeHtml(centro.name)}</p>
      <p class="text-xs text-slate-600">${escapeHtml(centro.direccion)}</p>
      <p class="text-xs text-slate-600">${escapeHtml(centro.horario)}</p>
      ${chips ? `<div class="flex flex-wrap gap-1">${chips}</div>` : ""}
      ${telefono}
      ${notas}
      <a
        class="centro-cta mt-1 flex w-full items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold no-underline shadow-sm transition hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-300"
        href="${directionsUrl(centro.lat, centro.lng)}"
        target="_blank"
        rel="noopener noreferrer"
      >${NAV_ICON}Cómo llegar</a>
    </div>`;
}

// `SANGRE_FILTER` es un valor reservado del filtro, no un id de `CATEGORIES`:
// filtra por tipo de punto, mientras que los demás filtran por qué se recibe.
function matchesFilter(centro: Centro): boolean {
  if (centroFilter === null) return true;
  if (centroFilter === SANGRE_FILTER) return centro.tipo === "sangre";
  return centro.tipo === "acopio" && centro.recibe.includes(centroFilter);
}

/** Repuebla la capa. Devuelve cuántos centros quedaron visibles. */
function applyCentros(): number {
  centrosLayer.clearLayers();
  if (!centrosVisible) return 0;
  let shown = 0;
  for (const { data, marker } of centros) {
    if (!matchesFilter(data)) continue;
    centrosLayer.addLayer(marker);
    shown += 1;
  }
  return shown;
}

export function setCentros(list: Centro[]): number {
  centros.length = 0;
  for (const data of list) {
    const marker = L.marker([data.lat, data.lng], {
      icon: data.tipo === "sangre" ? sangreIcon : centroIcon,
      zIndexOffset: -500,
    }).bindPopup(centroPopupHtml(data));
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
