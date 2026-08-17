import type { Report } from "./data/reports";
import { isRetired, type ReportStatus } from "./status";
import { newestIso } from "./ui/time";

export type GroupResource = {
  name: string;

  covered: boolean;

  reportIds: string[];
};

export type ReportGroup = {
  key: string;
  lead: Report;
  reports: Report[];
  resources: GroupResource[];

  pending: number;
  lat: number;
  lng: number;
  /**
   * Lo más reciente que se sabe de la zona: un reporte nuevo, un estado tocado
   * o una novedad escrita sobre cualquiera de sus reportes. Las tres cuentan
   * como «alguien pasó por ahí», y es lo que decide si el punto sigue vivo.
   */
  latestAt: string;
  /**
   * Estado de la zona: el del reporte cuyo estado se tocó de último. No es el
   * «peor» de los estados a propósito — «saturado» y «urgente» se contradicen,
   * y en una emergencia gana lo último que alguien vio en la calle.
   */
  status: ReportStatus;

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
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
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
 *
 * `freshAt` says how recently anybody touched a report, novedades included.
 * It comes in as an argument because the answer spans two tables and this
 * module knows nothing about stores — same reason `map.ts` gets `MarkerExtra`.
 * Required and not defaulted on purpose: a caller that forgot it would silently
 * retire points that somebody confirmed ten minutes ago, and that is exactly
 * the bug this parameter exists to fix. Pass `reportFreshAt` from
 * `data/reports.ts`.
 */
export function groupReports(
  reports: Report[],
  freshAt: (report: Report) => string,
  radiusM = CLUSTER_RADIUS_M,
): ReportGroup[] {
  const live = reports.filter(
    (report) => !isRetired(report.status, report.statusAt, freshAt(report)),
  );
  return buildGroups(live, freshAt, radiusM);
}

/**
 * The same zones, retired ones included. The one caller is the history in the
 * report form: a point that fell off the map is exactly what somebody is about
 * to report again, and its address and coordinates are still in the store.
 *
 * Deliberately a separate export instead of a flag on `groupReports`: the
 * invariant above — every live consumer walks through one door that retires a
 * point everywhere at once — only survives if the door that keeps them is
 * named, and has to be asked for.
 */
export function groupZones(
  reports: Report[],
  freshAt: (report: Report) => string,
  radiusM = CLUSTER_RADIUS_M,
): ReportGroup[] {
  return buildGroups(reports, freshAt, radiusM);
}

function buildGroups(
  reports: Report[],
  freshAt: (report: Report) => string,
  radiusM: number,
): ReportGroup[] {
  const groups: ReportGroup[] = [];

  for (const report of reports) {
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
        const entry = byName.get(name) ?? {
          name,
          covered: true,
          reportIds: [],
        };
        entry.reportIds.push(report.id);

        entry.covered &&= report.covered.includes(name);
        byName.set(name, entry);
      }
    }

    const all = [...byName.values()];

    group.resources = [
      ...all.filter((r) => !r.covered),
      ...all.filter((r) => r.covered),
    ];
    group.pending = all.filter((r) => !r.covered).length;

    const oldest = group.reports.reduce((a, b) =>
      a.createdAt <= b.createdAt ? a : b,
    );
    group.key = oldest.id;

    group.lat = oldest.lat;
    group.lng = oldest.lng;

    group.reportIds = group.reports.map((r) => r.id);

    group.latestAt = newestIso(...group.reports.map(freshAt));

    const freshest = group.reports.reduce((a, b) =>
      a.statusAt >= b.statusAt ? a : b,
    );
    group.status = freshest.status;
  }

  return groups;
}
