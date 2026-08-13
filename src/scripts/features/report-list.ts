import gsap from "gsap";
import { groupReports, type ReportGroup } from "../cluster";
import {
  getReports,
  onChange,
  onState,
  removeReport,
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
import { chipLabel, chipStyle } from "../ui/chips";
import { telUrl, whatsappUrl } from "../ui/contact";
import { $, scheduleRender } from "../ui/dom";
import { PHONE_ICON } from "../ui/html";
import { confirmClose } from "../ui/status-select";
import { isStale, newestIso, paintTime } from "../ui/time";

const reduceMotion = window.matchMedia(
  "(prefers-reduced-motion: reduce)",
).matches;

/** Grupos del último render: quién comparte punto con quién, al borrar. */
let lastGroups: ReportGroup[] = [];

let storeState: StoreState = "loading";
let storeMessage: string | null = null;

/** `null` = todos; `"urgente"` = solo urgentes; `"abiertos"` = sin llenos ni cerrados. */
let listFilter: string | null = DEFAULT_LIST_FILTER;

/** Whether the visitor picked a filter: the fallback below never overrides one. */
let filterChosen = false;

/**
 * Lo más reciente que se sabe de un punto: se creó, le tocaron el estado o
 * alguien publicó una novedad sobre él. Las tres cosas cuentan como «lo
 * confirmaron»; si solo se mirara la fecha de creación, un edificio reportado
 * anteayer y visitado hace diez minutos se vería igual de viejo.
 */
function groupFreshAt(group: ReportGroup): string {
  return newestIso(
    group.latestAt,
    ...group.reportIds.map((id) => latestUpdateFor(id)?.createdAt),
  );
}

/** La novedad más reciente de la zona, sin importar de qué reporte cuelgue. */
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
  const card = $<HTMLElement>("report-card");
  const toggle = $<HTMLButtonElement>("report-toggle");
  const caret = $<HTMLSpanElement>("report-caret");

  /** Chips de la zona: cada uno alterna «cubierto» en todos los que lo piden. */
  function buildGroupChips(group: ReportGroup): HTMLDivElement {
    const chips = document.createElement("div");
    chips.className = "mt-2 flex flex-wrap gap-1";

    // Reportar no exige insumos —la dirección es lo único obligatorio—, así que
    // la fila puede quedar vacía. La línea ocupa su lugar: el hueco solo se leía
    // como una tarjeta rota.
    if (group.resources.length === 0) {
      const empty = document.createElement("p");
      empty.className = "text-sm text-slate-500";
      empty.textContent = "Todavía no dice qué necesita.";
      chips.append(empty);
      return chips;
    }

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
   * El chip es el envase y no el `<select>`: la flecha nativa la pinta el
   * navegador contra el borde del elemento, fuera del flujo, así que el `px-2`
   * del chip no la corría y quedaba montada sobre la esquina redonda. Se apaga
   * con `appearance-none` y se dibuja como un glifo más, que sí respeta el
   * padding y hereda el color del estado. Mismo armado que `statusSelectHtml`.
   */
  function buildStatusChip(group: ReportGroup): HTMLSpanElement {
    const info = statusInfo(group.status);
    const chip = document.createElement("span");
    chip.className = `inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold focus-within:ring-2 focus-within:ring-slate-400 ${info.chip}`;
    chip.title = "Cómo está el punto ahora mismo";

    const select = document.createElement("select");
    select.className =
      "appearance-none border-0 bg-transparent p-0 font-semibold text-inherit outline-none";
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

    const caret = document.createElement("span");
    caret.className = "pointer-events-none text-[0.65rem] opacity-70";
    caret.setAttribute("aria-hidden", "true");
    caret.textContent = "▾";

    chip.append(select, caret);
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

      const wa = whatsappUrl(report.contactPhone);
      const call = document.createElement("a");
      call.className =
        "flex w-full text-center items-center justify-center gap-1.5 rounded-lg bg-emerald-600 p-3 text-sm font-semibold text-white no-underline shadow-sm transition hover:bg-emerald-700";
      call.href = wa ?? telUrl(report.contactPhone);
      if (wa) {
        call.target = "_blank";
        call.rel = "noopener noreferrer";
      }

      const icon = document.createElement("span");
      icon.className = "contents";
      icon.innerHTML = PHONE_ICON;

      const who = document.createElement("span");
      who.textContent = `${name} - ${report.contactPhone}`;

      call.append(icon, who);
      box.append(call);
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
    // Mismo guardia que el mapa: un reporte sin insumos tiene cero pendientes
    // sin haber cubierto nada, y pintarlo verde diría que la zona ya está
    // resuelta cuando lo único que pasa es que nadie ha dicho qué falta.
    const resolved = group.resources.length > 0 && group.pending === 0;
    // Un punto cerrado se apaga: sigue en la lista —quien lo vio ayer merece
    // saber que ya no recibe— pero deja de competir por la atención con los que
    // sí necesitan gente. Solo «cerrado»: un saturado vuelve a recibir en un
    // rato, un cerrado no.
    const dim = group.status === "cerrado" ? " opacity-60" : "";
    // Un punto cubierto se pinta verde pase lo que pase — que ya no falta nada
    // pesa más que cómo esté el sitio. Si falta algo, el color lo pone el estado.
    item.className = resolved
      ? `rounded-xl flex flex-col gap-3 border border-emerald-200 bg-emerald-50/40 px-3 py-4${dim}`
      : `rounded-xl flex flex-col gap-3 border px-3 py-4 ${statusInfo(group.status).card}${dim}`;

    const head = document.createElement("div");
    head.className = "flex items-start justify-between gap-2";

    // El nombre del lugar va encima de la dirección y más pequeño, igual que en
    // el popup. Los dos van en la misma columna: `head` es una fila con las
    // insignias a la derecha, y colgarlo de ahí lo mandaría a competir con ellas.
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
        "rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700";
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

    head.append(badges);

    // The status select gets its own row above the title: on a long address the
    // title wrapped around it and the select ended up floating mid-card.
    const statusRow = document.createElement("div");
    statusRow.className = "flex justify-end";
    statusRow.append(buildStatusChip(group));

    const meta = document.createElement("div");
    meta.className = "mt-2 flex items-center justify-between gap-2";

    const freshAt = groupFreshAt(group);
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

    // La última novedad va antes que la nota del reporte: es lo que alguien vio
    // en la calle más recientemente, y suele contradecir lo de arriba.
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

    // La tarjeta del grupo es la fila del reporte principal, así deleteReport la
    // anima; los demás reportes del punto ya no tienen fila propia.
    item.dataset.id = group.lead.id;

    // Sin sublista, este es el único sitio donde alguien puede borrar lo suyo, y
    // en un punto compartido lo suyo no tiene por qué ser el reporte principal.
    // Solo el autor puede borrar (policy de RLS): mostrarle el botón a los demás
    // sería ofrecer una acción que el servidor va a rechazar.
    for (const report of group.reports) {
      if (isMine(report)) actions.append(buildDeleteButton(report.id));
    }

    meta.append(time, actions);
    return item;
  }

  /** Lo que el mapa necesita de cada punto. Reconciliar es cosa de `map.ts`. */
  function markerEntries(groups: ReportGroup[]): MarkerEntry[] {
    return groups.map((group) => {
      // La frescura es la de la zona, la misma que pinta la tarjeta: si no, el
      // popup y la lista se contradicen sobre el mismo punto.
      const freshAt = groupFreshAt(group);
      return {
        group,
        extra: {
          freshAt,
          stale: isStale(freshAt),
          lastUpdate: groupLastUpdate(group)?.body,
        },
      };
    });
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
    // Con el filtro puesto, «no hay reportes» sería falso: los hay, pero otros.
    emptyState.textContent =
      total > 0
        ? "Ningún punto coincide con ese filtro."
        : "Aún no hay reportes.";
  }

  function deleteReport(id: string) {
    const key = markerKeyForReport(id);
    const group = lastGroups.find((g) => g.key === key);
    // Deleting one report out of a shared point does not delete the point: the
    // marker stays for whoever is still there, so animating it away would leave
    // an invisible pin behind. Only the last report of a point takes it with it,
    // and the re-render after `removeReport` is what actually detaches it.
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
    const groups = groupReports(reports);
    lastGroups = groups;

    // La lista abre en «Urgentes», pero un filtro que no deja nada a la vista
    // esconde la ciudad entera: sin urgentes, cae a «Todos». Sólo mientras
    // nadie haya tocado los chips —después, el filtro es de quien lo eligió.
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

    // Lo único que se resume arriba son los urgentes. El resto de cifras se
    // contradecían entre sí —una contaba reportes y otra puntos— y «saturados»
    // metía en el mismo saco a los cerrados, que no es lo mismo.
    const urgentes = groups.filter((g) => g.status === "urgente").length;
    reportUrgent.textContent = `${urgentes} urgente${urgentes === 1 ? "" : "s"}`;
    reportUrgent.classList.toggle("hidden", urgentes === 0);
    // Collapsed, the header is all there is to see: without the number it would
    // not say whether one zone was reported or forty.
    reportCount.textContent = String(groups.length);

    paintEmptyState(shown.length, groups.length);
    // Sobre todos los grupos, no sobre `shown`: el filtro de la lista nunca ha
    // escondido marcadores.
    syncReportMarkers(markerEntries(groups));
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

  // The accordion is desktop only, and it starts closed: the sidebar opens on
  // the map and on what is happening, not on a list forty cards long. The CSS
  // rule lives behind the `lg` media query, so `data-collapsed` is inert on
  // mobile and the sheet keeps showing its list whatever this says.
  card.dataset.collapsed = "true";
  toggle.addEventListener("click", () => {
    const open = card.dataset.collapsed === "true";
    card.dataset.collapsed = String(!open);
    toggle.setAttribute("aria-expanded", String(open));
    caret.textContent = open ? "▴" : "▾";
  });

  paintFilterChips();
  render();
}
