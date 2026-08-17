import { distanceMeters, groupZones, type ReportGroup } from "../cluster";
import {
  getReports,
  onChange,
  reportFreshAt,
  type Report,
} from "../data/reports";
import { onUpdates } from "../data/updates";
import { readCachedCoords, type Coords } from "../geolocation";
import { isRetired } from "../status";
import { $, scheduleRender } from "../ui/dom";
import { paintTime } from "../ui/time";
import { prefillReport } from "./report-form";
import { getUserCoords } from "./user-location";

/**
 * Los lugares ya reportados que ofrece el formulario de necesidad — la mitad en
 * JavaScript de `src/components/ReportHistory.astro`.
 *
 * Sale del store que ya está cargado: ningún reporte se borra de la base, así
 * que agrupar por cercanía sin filtrar los retirados devuelve todos los lugares
 * que alguna vez se reportaron. Por eso `groupZones` y no `groupReports`.
 *
 * La tarjeta entera es el botón, y hace una sola cosa: copiar la ubicación al
 * formulario. Nada de acciones sueltas dentro de la tarjeta — esto se lee de
 * reojo mientras se busca una dirección conocida, y una tarjeta con dos botones
 * obliga a decidir antes de haber reconocido el sitio. Lo que sí cambia según
 * el punto siga en el mapa o no es lo que dice la tarjeta, porque reponer un
 * reporte viejo y confirmar uno vigente no son la misma cosa.
 */

const MAX_ZONES = 6;

type Zone = {
  group: ReportGroup;

  distanceM: number | null;

  live: Report | null;
};

function isLive(report: Report): boolean {
  return !isRetired(report.status, report.statusAt, reportFreshAt(report));
}

/**
 * La posición viva primero y la guardada después: acá se escribe «a 300 m», no
 * se dibuja un «estás acá», así que una coordenada de la visita anterior sirve
 * igual y llega sin esperar al permiso. Con `null` no se escribe distancia y ya
 * — no cambia qué lugares se ofrecen.
 */
function anchor(): Coords | null {
  return getUserCoords() ?? readCachedCoords();
}

/**
 * Los más recientes, sin filtrar por cercanía. La distancia se muestra pero no
 * decide: recortar por radio deja la lista vacía sin decir por qué en cuanto
 * quien mira está lejos —o el permiso de ubicación devuelve algo raro—, y una
 * lista que se llama «recientes» y a veces no aparece es peor que una que
 * ofrece un lugar a diez cuadras.
 */
function pickZones(): Zone[] {
  const at = anchor();

  return groupZones(getReports(), reportFreshAt)
    .slice(0, MAX_ZONES)
    .map((group) => ({
      group,
      distanceM: at ? distanceMeters(at, group) : null,
      live: group.reports.find(isLive) ?? null,
    }));
}

function formatDistance(meters: number): string {
  return meters < 1000
    ? `a ${Math.round(meters)} m`
    : `a ${(meters / 1000).toFixed(1)} km`;
}

export function initReportHistory(): void {
  const section = $<HTMLDetailsElement>("report-history");
  const count = $<HTMLSpanElement>("report-history-count");
  const list = $<HTMLUListElement>("report-history-list");

  function buildZoneItem(zone: Zone): HTMLLIElement {
    const { group, live } = zone;
    const item = document.createElement("li");

    const card = document.createElement("button");
    card.type = "button";
    card.className =
      "block w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-left transition hover:border-red-400 hover:bg-red-50/40 focus:outline-none focus:ring-2 focus:ring-red-300";
    item.append(card);

    if (group.lead.placeName) {
      const place = document.createElement("p");
      place.className = "text-xs text-slate-600";
      place.textContent = group.lead.placeName;
      card.append(place);
    }

    const title = document.createElement("p");
    title.className = "text-sm font-semibold text-slate-900";
    title.textContent = group.lead.name;
    card.append(title);

    const meta = document.createElement("p");
    meta.className =
      "mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-slate-400";

    const time = document.createElement("span");
    paintTime(time, group.latestAt, "Actualizado ");
    meta.append(time);

    if (zone.distanceM !== null) {
      const distance = document.createElement("span");
      distance.textContent = formatDistance(zone.distanceM);
      meta.append(distance);
    }

    if (!live) {
      const badge = document.createElement("span");
      badge.className = "font-medium text-amber-600";
      badge.textContent = "ya no está en el mapa";
      meta.append(badge);
    }

    card.append(meta);

    card.addEventListener("click", () => {
      prefillReport({
        name: group.lead.name,
        placeName: group.lead.placeName,
        lat: group.lead.lat,
        lng: group.lead.lng,
      });

      section.open = false;
    });

    return item;
  }

  function render(): void {
    const zones = pickZones();
    list.replaceChildren(...zones.map(buildZoneItem));
    count.textContent = zones.length > 0 ? String(zones.length) : "";
    section.hidden = zones.length === 0;
  }

  const scheduled = scheduleRender(render);
  onChange(scheduled);

  onUpdates(scheduled);

  render();
}
