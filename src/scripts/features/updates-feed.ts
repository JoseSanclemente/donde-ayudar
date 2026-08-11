import { groupReports } from "../cluster";
import { getReports, onChange } from "../data/reports";
import { isMine } from "../data/session";
import { addUpdate, getUpdates, onUpdates, removeUpdate } from "../data/updates";
import { flyTo } from "../map";
import { collapseSheet } from "../sheet";
import { $, clearError, scheduleRender, showError } from "../ui/dom";
import { paintTime } from "../ui/time";

/** Cuántas novedades se ven antes de «Ver más». */
const PAGE = 20;

export function initUpdatesFeed(): void {
  const form = $<HTMLFormElement>("update-form");
  const body = $<HTMLTextAreaElement>("update-body");
  const count = $<HTMLSpanElement>("update-count");
  const select = $<HTMLSelectElement>("update-report");
  const error = $<HTMLParagraphElement>("update-error");
  const list = $<HTMLUListElement>("updates-list");
  const empty = $<HTMLParagraphElement>("updates-empty");
  const total = $<HTMLSpanElement>("updates-count");
  const more = $<HTMLButtonElement>("updates-more");

  let limit = PAGE;

  body.addEventListener("input", () => {
    count.textContent = String(body.value.length);
    if (body.value.trim().length >= 3) clearError(error);
  });

  more.addEventListener("click", () => {
    limit += PAGE;
    renderList();
  });

  /**
   * El selector se rearma con los puntos del mapa. Se conserva la selección: la
   * lista se repinta cada vez que llega un reporte ajeno, y perder el punto
   * elegido mientras alguien escribe es la peor forma de perder una novedad.
   */
  function renderOptions() {
    const chosen = select.value;
    const groups = groupReports(getReports());

    const options = [new Option("Novedad general", "")];
    for (const group of groups) {
      options.push(new Option(group.lead.name, group.lead.id));
    }
    select.replaceChildren(...options);

    // Si el punto elegido desapareció (lo borraron), vuelve a «general».
    select.value = options.some((o) => o.value === chosen) ? chosen : "";
  }

  function renderList() {
    const updates = getUpdates();
    total.textContent = String(updates.length);
    empty.classList.toggle("hidden", updates.length > 0);
    more.classList.toggle("hidden", updates.length <= limit);

    // Índice para poder nombrar el punto de cada novedad sin volver a agrupar.
    const names = new Map(getReports().map((report) => [report.id, report.name]));

    list.replaceChildren(
      ...updates.slice(0, limit).map((update) => {
        const item = document.createElement("li");
        item.className = "border-l-2 border-slate-200 pl-3";

        const meta = document.createElement("div");
        meta.className = "flex items-center justify-between gap-2";

        const time = document.createElement("span");
        time.className = "text-xs text-slate-400";
        paintTime(time, update.createdAt);
        meta.append(time);

        if (isMine(update)) {
          const del = document.createElement("button");
          del.type = "button";
          del.className = "text-xs font-medium text-slate-400 transition hover:text-red-600";
          del.textContent = "Borrar";
          del.addEventListener("click", () => removeUpdate(update.id));
          meta.append(del);
        }

        const text = document.createElement("p");
        text.className = "mt-0.5 text-sm leading-snug text-slate-700";
        text.textContent = update.body;

        item.append(meta, text);

        const name = update.reportId ? names.get(update.reportId) : undefined;
        if (name) {
          const link = document.createElement("button");
          link.type = "button";
          link.className = "mt-1 text-xs font-medium text-slate-500 hover:text-red-600";
          link.textContent = `↦ ${name}`;
          link.addEventListener("click", () => {
            const report = getReports().find((r) => r.id === update.reportId);
            if (!report) return;
            collapseSheet();
            void flyTo(report.lat, report.lng);
          });
          item.append(link);
        }

        return item;
      }),
    );
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = body.value.trim();
    // Espejo del CHECK de la base: 3 a 280.
    if (text.length < 3) {
      showError(error, "Escribe la novedad (mínimo 3 caracteres).");
      return;
    }
    clearError(error);

    addUpdate({ body: text, reportId: select.value || null });
    body.value = "";
    count.textContent = "0";
  });

  const scheduledList = scheduleRender(renderList);
  const scheduledOptions = scheduleRender(() => {
    renderOptions();
    renderList();
  });

  onUpdates(scheduledList);
  // Un reporte nuevo agrega una opción al selector y le pone nombre a las
  // novedades que ya lo apuntaban.
  onChange(scheduledOptions);

  renderOptions();
  renderList();
}
