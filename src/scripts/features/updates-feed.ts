import { groupReports } from "../cluster";
import { getReports, onChange, reportFreshAt, reportLabel } from "../data/reports";
import { isMine } from "../data/session";
import {
  addUpdate,
  getUpdates,
  onUpdates,
  removeUpdate,
} from "../data/updates";
import { flyTo } from "../map";
import { closeSheet, isTabVisible, onTabChange, setTabDot } from "../sheet";
import { $, clearError, maybe$, scheduleRender, showError } from "../ui/dom";
import { paintTime } from "../ui/time";

/** Cuántas novedades se ven antes de «Ver más». */
const PAGE = 20;

/** Panel al que apunta el punto de «hay algo nuevo». */
const TAB = "novedades";

export function initUpdatesFeed(): void {
  const form = $<HTMLFormElement>("update-form");
  const body = $<HTMLTextAreaElement>("update-body");
  // The character counter is decorative: `maxlength` is what actually caps the
  // body, so a layout without it must not take the whole boot down with it.
  const count = maybe$<HTMLSpanElement>("update-count");
  const select = $<HTMLSelectElement>("update-report");
  const error = $<HTMLParagraphElement>("update-error");
  const list = $<HTMLUListElement>("updates-list");
  const empty = $<HTMLParagraphElement>("updates-empty");
  const total = $<HTMLSpanElement>("updates-count");
  const more = $<HTMLButtonElement>("updates-more");
  let limit = PAGE;
  /** Novedades que el lector ya tuvo a la vista: lo que no está acá enciende
   * el punto. La carga inicial la siembra, así que abrir la página nunca lo
   * enciende — solo lo que llega después. */
  const seen = new Set<string>();
  /** La carga inicial llega después del `init` — hasta entonces `seen` está
   * vacío y todo parecería nuevo. */
  let primed = false;

  body.addEventListener("input", () => {
    if (count) count.textContent = String(body.value.length);
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
    const groups = groupReports(getReports(), reportFreshAt);

    const options = [new Option("Novedad general", "")];
    for (const group of groups) {
      options.push(new Option(reportLabel(group.lead), group.lead.id));
    }
    select.replaceChildren(...options);

    // Si el punto elegido desapareció (lo borraron), vuelve a «general».
    select.value = options.some((o) => o.value === chosen) ? chosen : "";
  }

  /**
   * El punto amarillo del botón «Novedades». Con el panel a la vista no hay
   * nada que avisar: todo lo que hay ya se está leyendo. Con el panel oculto,
   * enciende con la primera novedad ajena que no se haya visto — la propia no
   * es noticia para quien la escribió.
   */
  function paintDot() {
    const updates = getUpdates();
    if (isTabVisible(TAB)) {
      for (const update of updates) seen.add(update.id);
      setTabDot(TAB, false);
      return;
    }
    const fresh = updates.some(
      (update) => !seen.has(update.id) && !isMine(update),
    );
    if (fresh) setTabDot(TAB, true);
  }

  function renderList() {
    const updates = getUpdates();
    total.textContent = String(updates.length);
    empty.classList.toggle("hidden", updates.length > 0);
    more.classList.toggle("hidden", updates.length <= limit);

    // Índice para poder nombrar el punto de cada novedad sin volver a agrupar.
    const names = new Map(
      getReports().map((report) => [report.id, report.name]),
    );

    list.replaceChildren(
      ...updates.slice(0, limit).map((update) => {
        const item = document.createElement("li");
        item.className =
          "border-l-2 border-slate-200 pl-3 bg-slate-100 py-2 space-y-3";

        const meta = document.createElement("div");
        meta.className = "flex items-center justify-between gap-2";

        const time = document.createElement("span");
        time.className = "text-xs text-slate-400";
        paintTime(time, update.createdAt);
        meta.append(time);

        if (isMine(update)) {
          const del = document.createElement("button");
          del.type = "button";
          del.className =
            "text-xs font-medium text-slate-400 transition hover:text-red-600";
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
          link.className =
            "mt-1 text-sm underline font-medium text-slate-500 hover:text-red-600";
          link.textContent = `↦ ${name}`;
          link.addEventListener("click", () => {
            const report = getReports().find((r) => r.id === update.reportId);
            if (!report) return;
            closeSheet();
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
    if (count) count.textContent = "0";
  });

  const scheduledList = scheduleRender(() => {
    renderList();
    // La carga inicial no es novedad: lo que ya estaba en la base cuando se
    // abrió la página entra directo a `seen`.
    if (!primed) {
      primed = true;
      for (const update of getUpdates()) seen.add(update.id);
    }
    paintDot();
  });
  const scheduledOptions = scheduleRender(() => {
    renderOptions();
    renderList();
  });

  onUpdates(scheduledList);
  // Un reporte nuevo agrega una opción al selector y le pone nombre a las
  // novedades que ya lo apuntaban.
  onChange(scheduledOptions);
  // Abrir el panel es haber leído: el punto se apaga ahí, no en el próximo
  // repintado de la lista, que puede no llegar nunca.
  onTabChange(paintDot);

  renderOptions();
  renderList();
}
