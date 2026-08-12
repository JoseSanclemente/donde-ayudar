import type { Report } from "./data/reports";
import { isRetired, type ReportStatus } from "./status";
import { newestIso } from "./ui/time";

export type GroupResource = {
  name: string;
  /** true solo si todos los reportes que lo piden ya lo tienen cubierto. */
  covered: boolean;
  /** Reportes del grupo que piden este recurso — el alcance del toggle. */
  reportIds: string[];
};

export type ReportGroup = {
  key: string;
  lead: Report;
  reports: Report[];
  resources: GroupResource[];
  /** Recursos aún sin cubrir. 0 = zona resuelta. */
  pending: number;
  lat: number;
  lng: number;
  /** Lo más reciente que se sabe de la zona: un reporte nuevo o un estado tocado. */
  latestAt: string;
  /**
   * Estado de la zona: el del reporte cuyo estado se tocó de último. No es el
   * «peor» de los estados a propósito — «saturado» y «urgente» se contradicen,
   * y en una emergencia gana lo último que alguien vio en la calle.
   */
  status: ReportStatus;
  /** Ids que comparten ese estado — el alcance de un cambio desde la lista. */
  reportIds: string[];
};

export const CLUSTER_RADIUS_M = 50;

type Coords = { lat: number; lng: number };

const EARTH_RADIUS_M = 6371000;
const toRad = (deg: number) => (deg * Math.PI) / 180;

export function distanceMeters(a: Coords, b: Coords): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Agrupa por proximidad, recorriendo en el orden que llega del store
 * (más reciente primero). El primer reporte de cada grupo queda como `lead`,
 * así que un reporte recién creado siempre encabeza su grupo.
 *
 * Retired reports (see `isRetired`) never make it into a group. This is the one
 * door every consumer of the store walks through — list, map, alert banner,
 * offers panel — so filtering here retires the point from the whole UI at once.
 * A group left with no reports simply stops existing, and `syncReportMarkers`
 * drops its marker.
 */
export function groupReports(reports: Report[], radiusM = CLUSTER_RADIUS_M): ReportGroup[] {
  const groups: ReportGroup[] = [];

  for (const report of reports) {
    if (isRetired(report.status, report.statusAt)) continue;

    const group = groups.find((g) => distanceMeters(g.lead, report) <= radiusM);
    if (group) group.reports.push(report);
    else
      groups.push({
        key: report.id,
        lead: report,
        reports: [report],
        resources: [],
        pending: 0,
        lat: report.lat,
        lng: report.lng,
        latestAt: report.createdAt,
        status: report.status,
        reportIds: [],
      });
  }

  for (const group of groups) {
    const byName = new Map<string, GroupResource>();
    for (const report of group.reports) {
      for (const name of report.resources) {
        const entry = byName.get(name) ?? { name, covered: true, reportIds: [] };
        entry.reportIds.push(report.id);
        // Basta con que un reporte lo siga pidiendo para que la zona lo necesite.
        entry.covered &&= report.covered.includes(name);
        byName.set(name, entry);
      }
    }

    const all = [...byName.values()];
    // Pendientes arriba, cubiertos al final; estable dentro de cada bloque.
    group.resources = [...all.filter((r) => !r.covered), ...all.filter((r) => r.covered)];
    group.pending = all.filter((r) => !r.covered).length;

    const oldest = group.reports.reduce((a, b) => (a.createdAt <= b.createdAt ? a : b));
    group.key = oldest.id;

    // The map draws one marker per group, so the anchor is the same report that
    // gives the group its identity — not the lead. The lead is the newest report,
    // and anchoring there would make the pin hop up to `radiusM` every time a
    // neighbour is reported.
    group.lat = oldest.lat;
    group.lng = oldest.lng;

    group.reportIds = group.reports.map((r) => r.id);

    // `latestAt` se calcula acá y no al crear el grupo: el lead es el más nuevo
    // por creación, pero el estado que se tocó hace un minuto puede ser el de
    // un reporte viejo del mismo edificio.
    group.latestAt = newestIso(
      ...group.reports.map((r) => newestIso(r.createdAt, r.statusAt)),
    );

    const freshest = group.reports.reduce((a, b) => (a.statusAt >= b.statusAt ? a : b));
    group.status = freshest.status;
  }

  return groups;
}
