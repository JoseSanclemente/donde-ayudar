import type { Report } from "./store";

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
  latestAt: string;
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
 */
export function groupReports(reports: Report[], radiusM = CLUSTER_RADIUS_M): ReportGroup[] {
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
  }

  return groups;
}
