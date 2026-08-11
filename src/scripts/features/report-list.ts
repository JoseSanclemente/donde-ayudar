import gsap from "gsap";
import { groupReports, type ReportGroup } from "../cluster";
import {
  getReports,
  onChange,
  onState,
  removeReport,
  setReportStatus,
  setResourceCovered,
  type Report,
  type StoreState,
} from "../data/reports";
import { isMine } from "../data/session";
import { latestUpdateFor, onUpdates } from "../data/updates";
import {
  addMarker,
  detachMarker,
  flyTo,
  getMarkerElement,
  removeMarker,
  updateMarker,
  type MarkerExtra,
} from "../map";
import { CHIP_OFF, chipOnClass } from "../resources";
import { collapseSheet } from "../sheet";
import { isBlocked, statusInfo, STATUSES, type ReportStatus } from "../status";
import { chipLabel, chipStyle } from "../ui/chips";
import { telUrl, whatsappUrl } from "../ui/contact";
import { $, scheduleRender } from "../ui/dom";
import { isStale, newestIso, paintTime } from "../ui/time";

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Claves de los grupos desplegados — sobreviven al re-render completo. */
const expanded = new Set<string>();

/** Ids ya dibujados en el mapa. Los reportes ajenos llegan después del boot. */
const drawn = new Set<string>();

let storeState: StoreState = "loading";
let storeMessage: string | null = null;

/** `null` = todos; `"urgente"` = solo urgentes; `"abiertos"` = sin llenos ni cerrados. */
let listFilter: string | null = null;

/**
 * Lo más reciente que se sabe de un punto: se creó, le tocaron el estado o
 * alguien publicó una novedad sobre él. Las tres cosas cuentan como «lo
 * confirmaron»; si solo se mirara la fecha de creación, un edificio reportado
 * anteayer y visitado hace diez minutos se vería igual de viejo.
 */
function freshnessOf(report: Report): MarkerExtra {
  const last = latestUpdateFor(report.id);
  const freshAt = newestIso(report.createdAt, report.statusAt, last?.createdAt);
  return { freshAt, stale: isStale(freshAt), lastUpdate: last?.body };
}

/** La misma cuenta, para toda la zona. */
function groupFreshAt(group: ReportGroup): string {
  return newestIso(
    group.latestAt,
    ...group.reportIds.map((id) => latestUpdateFor(id)?.createdAt),
  );
}

/** La novedad más reciente de la zona, sin importar de qué reporte cuelgue. */
function groupLastUpdate(group: ReportGroup): { body: string; createdAt: string } | null {
  let best: { body: string; createdAt: string } | null = null;
  for (const id of group.reportIds) {
    const update = latestUpdateFor(id);
    if (!update) continue;
    if (!best || Date.parse(update.createdAt) > Date.parse(best.createdAt)) best = update;
  }
  return best;
}

export function initReportList(): void {
  const reportList = $<HTMLUListElement>("report-list");
  const reportCount = $<HTMLSpanElement>("report-count");
  const reportSummary = $<HTMLParagraphElement>("report-summary");
  const filterRow = $<HTMLDivElement>("report-filter");
  const emptyState = $<HTMLParagraphElement>("empty-state");

  /** Chips de la zona: cada uno alterna «cubierto» en todos los que lo piden. */
  function buildGroupChips(group: ReportGroup): HTMLDivElement {
    const chips = document.createElement("div");
    chips.className = "mt-2 flex flex-wrap gap-1";
    for (const resource of group.resources) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = `${chipStyle(resource.name, resource.covered)} transition hover:opacity-70`;
      chip.textContent = chipLabel(resource.name, resource.covered);
      chip.setAttribute("aria-pressed", String(resource.covered));
      const action = resource.covered
        ? `Volver a marcar ${resource.name} como necesario`
        : `Marcar ${resource.name} como cubierto`;
      chip.title = action;
      chip.setAttribute("aria-label", action);
      chip.addEventListener("click", () =>
        setResourceCovered(resource.reportIds, resource.name, !resource.covered),
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
   */
  function buildStatusSelect(group: ReportGroup): HTMLSelectElement {
    const info = statusInfo(group.status);
    const select = document.createElement("select");
    select.className = `rounded-full border-0 px-2 py-0.5 text-xs font-semibold ${info.chip}`;
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
      // Cerrar un punto le corta la ayuda a todo el mundo, y cualquiera puede
      // hacerlo: al menos que no sea por un toque accidental en la lista.
      if (
        next === "cerrado" &&
        !confirm(
          `¿Marcar «${group.lead.name}» como cerrado? Le va a aparecer a todo el mundo como «no te desplaces».`,
        )
      ) {
        select.value = group.status;
        return;
      }
      setReportStatus(group.reportIds, next);
    });

    return select;
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
      line.className = "text-xs leading-snug text-slate-600";
      line.textContent = `“${note}”`;
      box.append(line);
    }
    return box;
  }

  /** Contactos publicados por quien reportó. Públicos y opcionales. */
  function buildGroupContacts(group: ReportGroup): HTMLDivElement | null {
    const contacts = group.reports.filter((r) => r.contactName).slice(0, 2);
    if (contacts.length === 0) return null;

    const box = document.createElement("div");
    box.className = "mt-2 flex flex-wrap items-center gap-x-3 gap-y-1";
    for (const report of contacts) {
      const line = document.createElement("span");
      line.className = "text-xs text-slate-600";
      line.textContent = report.contactName as string;
      box.append(line);

      if (!report.contactPhone) continue;
      const wa = whatsappUrl(report.contactPhone);
      const link = document.createElement("a");
      link.className = "text-xs font-semibold text-emerald-700 hover:underline";
      link.href = wa ?? telUrl(report.contactPhone);
      if (wa) {
        link.target = "_blank";
        link.rel = "noopener noreferrer";
      }
      link.textContent = report.contactPhone;
      box.append(link);
    }
    return box;
  }

  /** Chips de un reporte suelto: solo lectura, la acción vive a nivel de zona. */
  function buildReportChips(report: Report): HTMLDivElement {
    const chips = document.createElement("div");
    chips.className = "mt-2 flex flex-wrap gap-1";
    const covered = new Set(report.covered);
    const ordered = [
      ...report.resources.filter((r) => !covered.has(r)),
      ...report.resources.filter((r) => covered.has(r)),
    ];
    for (const resource of ordered) {
      const chip = document.createElement("span");
      chip.className = chipStyle(resource, covered.has(resource));
      chip.textContent = chipLabel(resource, covered.has(resource));
      chips.append(chip);
    }
    return chips;
  }

  function buildDeleteButton(id: string): HTMLButtonElement {
    const del = document.createElement("button");
    del.type = "button";
    del.className = "text-xs font-medium text-slate-400 transition hover:text-red-600";
    del.textContent = "Eliminar";
    del.addEventListener("click", () => deleteReport(id));
    return del;
  }

  function buildMemberItem(report: Report): HTMLLIElement {
    const item = document.createElement("li");
    item.dataset.id = report.id;
    item.className = "rounded-lg border border-slate-200 bg-slate-50 p-2";

    const meta = document.createElement("div");
    meta.className = "flex items-center justify-between gap-2";

    const time = document.createElement("span");
    time.className = "text-xs text-slate-400";
    paintTime(time, report.createdAt);

    // Solo el autor puede borrar (policy de RLS): mostrarle el botón a los demás
    // sería ofrecer una acción que el servidor va a rechazar.
    meta.append(time);
    if (isMine(report)) meta.append(buildDeleteButton(report.id));
    item.append(buildReportChips(report), meta);
    return item;
  }

  function buildGroupItem(group: ReportGroup): HTMLLIElement {
    const count = group.reports.length;
    const item = document.createElement("li");
    item.dataset.groupKey = group.key;
    item.dataset.leadId = group.lead.id;
    const resolved = group.pending === 0;
    const blocked = isBlocked(group.status);
    // Un punto bloqueado se apaga: sigue en la lista, pero deja de invitar.
    item.className = blocked
      ? "rounded-xl border border-slate-200 bg-slate-50 p-3"
      : resolved
        ? "rounded-xl border border-emerald-200 bg-emerald-50/40 p-3"
        : "rounded-xl border border-slate-200 p-3";

    const head = document.createElement("div");
    head.className = "flex items-start justify-between gap-2";

    const title = document.createElement("p");
    title.className = "text-sm font-semibold text-slate-900";
    title.textContent = group.lead.name;
    head.append(title);

    const badges = document.createElement("div");
    badges.className = "flex shrink-0 items-center gap-1";

    if (count > 1) {
      const badge = document.createElement("span");
      badge.className = "rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700";
      badge.textContent = `${count} reportes`;
      badges.append(badge);
    }

    if (resolved) {
      const badge = document.createElement("span");
      badge.className =
        "rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700";
      badge.textContent = "Cubierto";
      badges.append(badge);
    }

    badges.append(buildStatusSelect(group));
    head.append(badges);

    const meta = document.createElement("div");
    meta.className = "mt-2 flex items-center justify-between gap-2";

    const freshAt = groupFreshAt(group);
    const stale = isStale(freshAt);
    const time = document.createElement("span");
    time.className = stale ? "text-xs font-medium text-amber-700" : "text-xs text-slate-400";
    paintTime(time, freshAt, "Actualizado ");
    if (stale) time.title = "Nadie lo confirma hace horas: verifica antes de ir.";

    const actions = document.createElement("div");
    actions.className = "flex gap-2";

    const view = document.createElement("button");
    view.type = "button";
    view.className = "text-xs font-medium text-slate-600 transition hover:text-red-600";
    view.textContent = "Ver en el mapa";
    view.addEventListener("click", () => {
      collapseSheet();
      void flyTo(group.lat, group.lng);
    });
    actions.append(view);

    item.append(head, buildGroupChips(group));

    // La última novedad va antes que la nota del reporte: es lo que alguien vio
    // en la calle más recientemente, y suele contradecir lo de arriba.
    const last = groupLastUpdate(group);
    if (last) {
      const line = document.createElement("p");
      line.className = "mt-2 rounded-lg bg-slate-50 px-2 py-1 text-xs leading-snug text-slate-700";
      line.textContent = last.body;
      item.append(line);
    }

    const notes = buildGroupNotes(group);
    if (notes) item.append(notes);
    const contacts = buildGroupContacts(group);
    if (contacts) item.append(contacts);
    item.append(meta);

    if (count === 1) {
      // sin sublista: la fila del grupo es la del reporte, así deleteReport la anima
      item.dataset.id = group.lead.id;
      if (isMine(group.lead)) actions.append(buildDeleteButton(group.lead.id));
      meta.append(time, actions);
      return item;
    }

    const members = document.createElement("ul");
    members.id = `group-${group.key}`;
    members.className = "mt-2 space-y-2";
    for (const report of group.reports) members.append(buildMemberItem(report));

    const isOpen = expanded.has(group.key);
    members.classList.toggle("hidden", !isOpen);

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "text-xs font-medium text-slate-600 transition hover:text-red-600";
    toggle.setAttribute("aria-controls", members.id);
    const syncToggle = (open: boolean) => {
      toggle.setAttribute("aria-expanded", String(open));
      toggle.textContent = open ? "Ocultar" : `Ver los ${count} reportes`;
    };
    syncToggle(isOpen);

    toggle.addEventListener("click", () => {
      const open = !expanded.has(group.key);
      if (open) expanded.add(group.key);
      else expanded.delete(group.key);
      syncToggle(open);

      if (reduceMotion) {
        members.classList.toggle("hidden", !open);
        return;
      }
      if (open) {
        members.classList.remove("hidden");
        gsap.from(members, {
          height: 0,
          opacity: 0,
          marginTop: 0,
          duration: 0.3,
          ease: "power3.out",
        });
      } else {
        gsap.to(members, {
          height: 0,
          opacity: 0,
          marginTop: 0,
          duration: 0.25,
          onComplete: () => {
            gsap.set(members, { clearProps: "all" });
            members.classList.add("hidden");
          },
        });
      }
    });

    actions.append(toggle);
    meta.append(time, actions);
    item.append(members);
    return item;
  }

  /** Reconcilia los marcadores con la lista: agrega, actualiza y quita. */
  function syncMarkers(reports: Report[]) {
    const live = new Set<string>();
    for (const report of reports) {
      live.add(report.id);
      const extra = freshnessOf(report);
      if (drawn.has(report.id)) {
        // El popup se enlaza una sola vez en addMarker: sin esto queda viejo.
        updateMarker(report, extra);
      } else {
        addMarker(report, extra);
        drawn.add(report.id);
      }
    }
    for (const id of drawn) {
      if (live.has(id)) continue;
      const marker = removeMarker(id);
      if (marker) detachMarker(marker);
      drawn.delete(id);
    }
  }

  // Mientras los reportes vienen en camino no se puede decir «no hay reportes»:
  // sería mentira, y sobre una emergencia es una mentira cara.
  function paintEmptyState(shown: number, total: number) {
    if (shown > 0 && storeState !== "error") {
      emptyState.classList.add("hidden");
      return;
    }
    emptyState.classList.remove("hidden");
    if (storeState === "error") {
      emptyState.textContent = storeMessage ?? "No se pudieron cargar los reportes.";
      emptyState.className = "mt-3 text-sm text-red-600";
      return;
    }
    emptyState.className = "mt-3 text-sm text-slate-500";
    if (storeState === "loading") {
      emptyState.textContent = "Cargando reportes…";
      return;
    }
    // Con el filtro puesto, «no hay reportes» sería falso: los hay, pero otros.
    emptyState.textContent =
      total > 0 ? "Ningún punto coincide con ese filtro." : "Aún no hay reportes.";
  }

  function deleteReport(id: string) {
    const marker = removeMarker(id);
    const item = reportList.querySelector<HTMLLIElement>(`[data-id="${id}"]`);
    const finish = () => {
      if (marker) detachMarker(marker);
      removeReport(id);
    };

    if (reduceMotion || (!marker && !item)) {
      finish();
      return;
    }

    const markerEl = getMarkerElement(id);
    const timeline = gsap.timeline({ onComplete: finish });
    if (markerEl) {
      timeline.to(markerEl, { scale: 0, opacity: 0, duration: 0.3, ease: "back.in(2)" }, 0);
    }
    if (item) {
      timeline.to(item, { opacity: 0, height: 0, margin: 0, padding: 0, duration: 0.3 }, 0);
    }
  }

  function matchesFilter(group: ReportGroup): boolean {
    if (listFilter === null) return true;
    if (listFilter === "urgente") return group.status === "urgente";
    return !isBlocked(group.status);
  }

  function paintFilterChips() {
    for (const chip of filterRow.querySelectorAll<HTMLButtonElement>("[data-list-filter]")) {
      const on = (chip.dataset.listFilter ?? "") === (listFilter ?? "");
      chip.setAttribute("aria-pressed", String(on));
      chip.className = on ? chipOnClass(undefined) : CHIP_OFF;
    }
  }

  filterRow.addEventListener("click", (event) => {
    const chip = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-list-filter]");
    if (!chip) return;
    listFilter = chip.dataset.listFilter || null;
    paintFilterChips();
    render();
  });

  function render() {
    const reports = getReports();
    const groups = groupReports(reports);
    const keys = new Set(groups.map((g) => g.key));
    for (const key of expanded) if (!keys.has(key)) expanded.delete(key);

    const shown = groups.filter(matchesFilter);
    reportList.replaceChildren(...shown.map(buildGroupItem));

    reportCount.textContent = String(reports.length);

    // El contador de arriba cuenta reportes; este cuenta puntos, que es lo que
    // se ve en la lista y en el mapa. Sin la aclaración los dos números se
    // contradicen.
    const urgentes = groups.filter((g) => g.status === "urgente").length;
    const bloqueados = groups.filter((g) => isBlocked(g.status)).length;
    const partes = [
      `${groups.length} ${groups.length === 1 ? "punto" : "puntos"}`,
      urgentes > 0 ? `${urgentes} urgente${urgentes === 1 ? "" : "s"}` : null,
      bloqueados > 0 ? `${bloqueados} sin recibir` : null,
    ].filter(Boolean);
    reportSummary.textContent = groups.length > 0 ? partes.join(" · ") : "";

    paintEmptyState(shown.length, groups.length);
    syncMarkers(reports);
  }

  const scheduled = scheduleRender(render);

  onChange(scheduled);
  // Una novedad cambia la frescura de un punto y la línea que se ve en la
  // tarjeta, aunque el reporte en sí no se haya tocado.
  onUpdates(scheduled);
  onState((state, message) => {
    storeState = state;
    storeMessage = message;
    // Los reportes ajenos cambian quién puede borrar qué: hay que repintar.
    scheduled();
  });

  paintFilterChips();
  render();
}
