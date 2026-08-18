import gsap from "gsap";
import { groupReports, type ReportGroup } from "../cluster";
import {
  getReports,
  onChange,
  onState,
  removeReport,
  reportFreshAt,
  setReportStatus,
  setResourceCovered,
  type StoreState,
} from "../data/reports";
import { isMine } from "../data/session";
import { latestUpdateFor, onUpdates } from "../data/updates";
import {
  flyTo,
  getMarkerElement,
  markerKeyForReport,
  syncReportMarkers,
  type MarkerEntry,
} from "../map";
import { CHIP_OFF, chipOnClass } from "../resources";
import { closeSheet } from "../sheet";
import {
  DEFAULT_LIST_FILTER,
  isBlocked,
  statusInfo,
  STATUSES,
  type ReportStatus,
} from "../status";
import { buildResourceChip } from "@/components/ui/ResourceChip";
import { buildContactCta } from "@/components/ui/ContactCta";
import { $, scheduleRender } from "../ui/dom";
import { buildCaret, SELECT_CHIP } from "../ui/select";
import { confirmClose } from "../ui/status-select";
import { isStale, paintTime } from "../ui/time";

const reduceMotion = window.matchMedia(
  "(prefers-reduced-motion: reduce)",
).matches;

let lastGroups: ReportGroup[] = [];

let storeState: StoreState = "loading";
let storeMessage: string | null = null;

let listFilter: string | null = DEFAULT_LIST_FILTER;

let filterChosen = false;

function groupLastUpdate(
  group: ReportGroup,
): { body: string; createdAt: string } | null {
  let best: { body: string; createdAt: string } | null = null;
  for (const id of group.reportIds) {
    const update = latestUpdateFor(id);
    if (!update) continue;
    if (!best || Date.parse(update.createdAt) > Date.parse(best.createdAt))
      best = update;
  }
  return best;
}

export function initReportList(): void {
  const reportList = $<HTMLUListElement>("report-list");
  const reportUrgent = $<HTMLSpanElement>("report-urgent");
  const reportCount = $<HTMLSpanElement>("report-count");
  const filterRow = $<HTMLDivElement>("report-filter");
  const emptyState = $<HTMLParagraphElement>("empty-state");

  function buildGroupChips(group: ReportGroup): HTMLDivElement {
    const chips = document.createElement("div");
    chips.className = "mt-2 flex flex-wrap gap-1";

    if (group.resources.length === 0) {
      const empty = document.createElement("p");
      empty.className = "text-sm text-slate-500";
      empty.textContent = "Todavía no dice qué necesita.";
      chips.append(empty);
      return chips;
    }

    for (const resource of group.resources) {
      const chip = buildResourceChip(resource);
      chip.addEventListener("click", () =>
        setResourceCovered(
          resource.reportIds,
          resource.name,
          !resource.covered,
        ),
      );
      chips.append(chip);
    }
    return chips;
  }

  /**
   * El estado es comunitario: lo cambia cualquiera, no solo quien reportó.
   *
   * Va como `<select>` y no como cuatro chips porque la lista ya está llena de
   * chips que significan otra cosa (recursos), y porque en móvil el selector
   * nativo es una sola línea en vez de cuatro botones que empujan la tarjeta.
   *
   * Mismo armado que `statusSelectHtml`, en elementos y una talla más chica: una
   * tarjeta de la lista no es el encabezado de un popup.
   */
  function buildStatusChip(group: ReportGroup): HTMLSpanElement {
    const info = statusInfo(group.status);
    const chip = document.createElement("span");
    chip.className = `inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold ${info.chip}`;
    chip.title = "Cómo está el punto ahora mismo";

    const select = document.createElement("select");
    select.className = SELECT_CHIP;
    select.setAttribute("aria-label", `Estado de ${group.lead.name}`);
    select.title = "Cómo está el punto ahora mismo";

    for (const status of STATUSES) {
      const option = document.createElement("option");
      option.value = status.id;
      option.textContent = status.label;
      option.selected = status.id === group.status;
      select.append(option);
    }

    select.addEventListener("change", () => {
      const next = select.value as ReportStatus;
      if (next === "cerrado" && !confirmClose(group.lead.name)) {
        select.value = group.status;
        return;
      }
      setReportStatus(group.reportIds, next);
    });

    chip.append(select, buildCaret("chip"));
    return chip;
  }

  /**
   * Las notas libres de la zona, la más reciente primero y máximo dos: son lo
   * que no cabe en el catálogo de recursos y suelen contradecirlo («ya no más
   * agua»), así que van pegadas a los chips y no escondidas en el detalle.
   */
  function buildGroupNotes(group: ReportGroup): HTMLDivElement | null {
    const notes = group.reports
      .filter((r) => r.note)
      .slice(0, 2)
      .map((r) => r.note as string);
    if (notes.length === 0) return null;

    const box = document.createElement("div");
    box.className = "mt-2 space-y-1";
    for (const note of notes) {
      const line = document.createElement("p");
      line.className = "text-sm leading-snug text-slate-600";
      line.textContent = `“${note}”`;
      box.append(line);
    }
    return box;
  }

  /**
   * Contactos publicados por quien reportó. Públicos y opcionales.
   *
   * Con teléfono va el mismo CTA verde de la ayuda disponible: confirmar antes
   * de desplazarse es el consejo que repite toda la página, y el número escrito
   * en texto chiquito lo deja en manos de quien sepa copiarlo. Sin teléfono
   * queda el nombre suelto — no hay nada que tocar.
   */
  function buildGroupContacts(group: ReportGroup): HTMLDivElement | null {
    const contacts = group.reports.filter((r) => r.contactName).slice(0, 2);
    if (contacts.length === 0) return null;

    const box = document.createElement("div");
    box.className = "mt-2 flex flex-col gap-2";
    for (const report of contacts) {
      const name = report.contactName as string;

      if (!report.contactPhone) {
        const line = document.createElement("span");
        line.className = "text-xs text-slate-600";
        line.textContent = name;
        box.append(line);
        continue;
      }

      box.append(buildContactCta(name, report.contactPhone));
    }
    return box;
  }

  function buildDeleteButton(id: string): HTMLButtonElement {
    const del = document.createElement("button");
    del.type = "button";
    del.className =
      "text-xs font-medium text-slate-400 transition hover:text-red-600";
    del.textContent = "Eliminar";
    del.addEventListener("click", () => deleteReport(id));
    return del;
  }

  function buildGroupItem(group: ReportGroup): HTMLLIElement {
    const count = group.reports.length;
    const item = document.createElement("li");
    item.dataset.groupKey = group.key;
    item.dataset.leadId = group.lead.id;

    const resolved = group.resources.length > 0 && group.pending === 0;

    const dim = group.status === "cerrado" ? " opacity-60" : "";

    item.className = resolved
      ? `rounded-xl flex flex-col gap-3 border border-emerald-200 bg-emerald-50/40 px-3 py-4${dim}`
      : `rounded-xl flex flex-col gap-3 border px-3 py-4 ${statusInfo(group.status).card}${dim}`;

    const head = document.createElement("div");
    head.className = "flex items-start justify-between gap-2";

    const titles = document.createElement("div");
    if (group.lead.placeName) {
      const place = document.createElement("p");
      place.className = "text-xs text-slate-600";
      place.textContent = group.lead.placeName;
      titles.append(place);
    }

    const title = document.createElement("p");
    title.className = "text-base font-semibold text-slate-900";
    title.textContent = group.lead.name;
    titles.append(title);
    head.append(titles);

    const badges = document.createElement("div");
    badges.className = "flex shrink-0 items-center gap-1";

    if (count > 1) {
      const badge = document.createElement("span");
      badge.className =
        "rounded-full border border-red-700 bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700";
      badge.textContent = `${count} reportes`;
      badges.append(badge);
    }

    if (resolved) {
      const badge = document.createElement("span");
      badge.className =
        "rounded-full border border-emerald-700 bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700";
      badge.textContent = "Cubierto";
      badges.append(badge);
    }

    head.append(badges);

    const statusRow = document.createElement("div");
    statusRow.className = "flex justify-end";
    statusRow.append(buildStatusChip(group));

    const meta = document.createElement("div");
    meta.className = "mt-2 flex items-center justify-between gap-2";

    const freshAt = group.latestAt;
    const stale = isStale(freshAt);
    const time = document.createElement("span");
    time.className = stale
      ? "text-xs font-medium text-amber-700"
      : "text-xs text-slate-400";
    paintTime(time, freshAt, "Actualizado ");
    if (stale)
      time.title = "Nadie lo confirma hace horas: verifica antes de ir.";

    const actions = document.createElement("div");
    actions.className = "flex gap-2";

    const view = document.createElement("button");
    view.type = "button";
    view.className =
      "text-xs font-medium text-slate-600 transition hover:text-red-600 underline";
    view.textContent = "Ver en el mapa";
    view.addEventListener("click", () => {
      closeSheet();
      void flyTo(group.lat, group.lng);
    });
    actions.append(view);

    item.append(statusRow, head, buildGroupChips(group));

    const last = groupLastUpdate(group);
    if (last) {
      const line = document.createElement("p");
      line.className =
        "mt-2 rounded-lg bg-slate-50 px-2 py-1 text-xs leading-snug text-slate-700";
      line.textContent = last.body;
      item.append(line);
    }

    const notes = buildGroupNotes(group);
    if (notes) item.append(notes);
    const contacts = buildGroupContacts(group);
    if (contacts) item.append(contacts);
    item.append(meta);

    item.dataset.id = group.lead.id;

    for (const report of group.reports) {
      if (isMine(report)) actions.append(buildDeleteButton(report.id));
    }

    meta.append(time, actions);
    return item;
  }

  function markerEntries(groups: ReportGroup[]): MarkerEntry[] {
    return groups.map((group) => {
      const freshAt = group.latestAt;
      return {
        group,
        extra: {
          freshAt,
          stale: isStale(freshAt),
          lastUpdate: groupLastUpdate(group)?.body,
          lastUpdateAt: groupLastUpdate(group)?.createdAt,
        },
      };
    });
  }

  function paintEmptyState(shown: number, total: number) {
    if (shown > 0 && storeState !== "error") {
      emptyState.classList.add("hidden");
      return;
    }
    emptyState.classList.remove("hidden");
    if (storeState === "error") {
      emptyState.textContent =
        storeMessage ?? "No se pudieron cargar los reportes.";
      emptyState.className = "mt-3 text-sm text-red-600";
      return;
    }
    emptyState.className = "mt-3 text-sm text-slate-500";
    if (storeState === "loading") {
      emptyState.textContent = "Cargando reportes…";
      return;
    }

    emptyState.textContent =
      total > 0
        ? "Ningún punto coincide con ese filtro."
        : "Aún no hay reportes.";
  }

  function deleteReport(id: string) {
    const key = markerKeyForReport(id);
    const group = lastGroups.find((g) => g.key === key);

    const alone = !group || group.reports.length === 1;
    const item = reportList.querySelector<HTMLLIElement>(`[data-id="${id}"]`);
    const finish = () => removeReport(id);

    const markerEl = alone ? getMarkerElement(id) : undefined;
    if (reduceMotion || (!markerEl && !item)) {
      finish();
      return;
    }

    const timeline = gsap.timeline({ onComplete: finish });
    if (markerEl) {
      timeline.to(
        markerEl,
        { scale: 0, opacity: 0, duration: 0.3, ease: "back.in(2)" },
        0,
      );
    }
    if (item) {
      timeline.to(
        item,
        { opacity: 0, height: 0, margin: 0, padding: 0, duration: 0.3 },
        0,
      );
    }
  }

  function matchesFilter(group: ReportGroup): boolean {
    if (listFilter === null) return true;
    if (listFilter === "urgente") return group.status === "urgente";
    return !isBlocked(group.status);
  }

  function paintFilterChips() {
    for (const chip of filterRow.querySelectorAll<HTMLButtonElement>(
      "[data-list-filter]",
    )) {
      const on = (chip.dataset.listFilter ?? "") === (listFilter ?? "");
      chip.setAttribute("aria-pressed", String(on));
      chip.className = on ? chipOnClass(undefined) : CHIP_OFF;
    }
  }

  filterRow.addEventListener("click", (event) => {
    const chip = (event.target as HTMLElement).closest<HTMLButtonElement>(
      "[data-list-filter]",
    );
    if (!chip) return;
    listFilter = chip.dataset.listFilter || null;
    filterChosen = true;
    paintFilterChips();
    render();
  });

  function render() {
    const reports = getReports();
    const groups = groupReports(reports, reportFreshAt);
    lastGroups = groups;

    if (
      !filterChosen &&
      listFilter === DEFAULT_LIST_FILTER &&
      groups.length > 0 &&
      !groups.some(matchesFilter)
    ) {
      listFilter = null;
      paintFilterChips();
    }

    const shown = groups.filter(matchesFilter);
    reportList.replaceChildren(...shown.map(buildGroupItem));

    const urgentes = groups.filter((g) => g.status === "urgente").length;
    reportUrgent.textContent = `${urgentes} urgente${urgentes === 1 ? "" : "s"}`;
    reportUrgent.classList.toggle("hidden", urgentes === 0);

    reportCount.textContent = String(groups.length);

    paintEmptyState(shown.length, groups.length);

    syncReportMarkers(markerEntries(groups));
  }

  const scheduled = scheduleRender(render);

  onChange(scheduled);

  onUpdates(scheduled);
  onState((state, message) => {
    storeState = state;
    storeMessage = message;

    scheduled();
  });

  paintFilterChips();
  render();
}
