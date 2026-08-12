import { groupReports } from "../cluster";
import { addOffer, assignOffer, getOffers, onOffers, removeOffer } from "../data/offers";
import { getReports, onChange } from "../data/reports";
import { isMine } from "../data/session";
import { flyTo } from "../map";
import { categoryChip, categoryLabel } from "../resources";
import { closeSheet } from "../sheet";
import { CHIP_SHAPE } from "../ui/chips";
import { isValidPhone, telUrl, whatsappUrl } from "../ui/contact";
import { $, clearError, scheduleRender, showError } from "../ui/dom";
import { paintTime } from "../ui/time";

/** Cuántas ofertas se ven antes de «Ver más». */
const PAGE = 10;

export function initOffersPanel(): void {
  const form = $<HTMLFormElement>("offer-form");
  const title = $<HTMLInputElement>("offer-title");
  const detail = $<HTMLTextAreaElement>("offer-detail");
  const category = $<HTMLSelectElement>("offer-category");
  const contactName = $<HTMLInputElement>("offer-contact-name");
  const contactPhone = $<HTMLInputElement>("offer-contact-phone");
  const error = $<HTMLParagraphElement>("offer-error");
  const list = $<HTMLUListElement>("offers-list");
  const empty = $<HTMLParagraphElement>("offers-empty");
  const total = $<HTMLSpanElement>("offers-count");
  const more = $<HTMLButtonElement>("offers-more");

  let limit = PAGE;

  more.addEventListener("click", () => {
    limit += PAGE;
    renderList();
  });

  /** Los puntos del mapa, agrupados igual que en la lista: uno por zona. */
  function points(): { id: string; name: string }[] {
    return groupReports(getReports()).map((group) => ({
      id: group.lead.id,
      name: group.lead.name,
    }));
  }

  /**
   * Selector de destino de una oferta. Va por RPC, así que cualquiera puede
   * despacharla: quien coordina en la calle no es quien publicó la máquina.
   */
  function assignSelect(offerId: string, current: string | null): HTMLSelectElement {
    const select = document.createElement("select");
    select.className =
      "min-w-0 flex-1 rounded-lg border border-slate-300 px-2 py-1 text-xs text-slate-700 shadow-sm outline-none focus:border-slate-400";
    select.setAttribute("aria-label", "Punto al que se despacha esta ayuda");

    const options = [new Option("Sin asignar", "")];
    for (const point of points()) options.push(new Option(point.name, point.id));
    // El punto ya no está en el mapa (lo borraron) pero la oferta lo apunta: se
    // agrega a mano para no cambiarle el destino en silencio a nadie.
    if (current && !options.some((o) => o.value === current)) {
      options.push(new Option("Punto que ya no está", current));
    }
    select.replaceChildren(...options);
    select.value = current ?? "";

    select.addEventListener("change", () => {
      assignOffer(offerId, select.value || null);
    });
    return select;
  }

  function renderList() {
    const offers = getOffers();
    const available = offers.filter((offer) => !offer.reportId).length;
    // Cuenta lo que todavía se puede mover: una oferta ya despachada no es
    // capacidad disponible.
    total.textContent = String(available);
    empty.classList.toggle("hidden", offers.length > 0);
    more.classList.toggle("hidden", offers.length <= limit);

    const names = new Map(getReports().map((report) => [report.id, report.name]));

    list.replaceChildren(
      ...offers.slice(0, limit).map((offer) => {
        const item = document.createElement("li");
        item.className = `rounded-lg border p-3 ${
          offer.reportId ? "border-slate-200 bg-slate-50" : "border-slate-200 bg-white"
        }`;

        const head = document.createElement("div");
        head.className = "flex items-start justify-between gap-2";

        const name = document.createElement("p");
        name.className = "text-sm font-semibold text-slate-900";
        name.textContent = offer.title;
        head.append(name);

        if (isMine(offer)) {
          const del = document.createElement("button");
          del.type = "button";
          del.className =
            "shrink-0 text-xs font-medium text-slate-400 transition hover:text-red-600";
          del.textContent = "Retirar";
          del.addEventListener("click", () => removeOffer(offer.id));
          head.append(del);
        }

        const meta = document.createElement("div");
        meta.className = "mt-1 flex flex-wrap items-center gap-2";

        const time = document.createElement("span");
        time.className = "text-xs text-slate-400";
        paintTime(time, offer.createdAt);
        meta.append(time);

        if (offer.category) {
          const chip = document.createElement("span");
          chip.className = `${CHIP_SHAPE} ${categoryChip(offer.category)}`;
          chip.textContent = categoryLabel(offer.category);
          meta.append(chip);
        }

        item.append(head, meta);

        if (offer.detail) {
          const text = document.createElement("p");
          text.className = "mt-1 text-sm leading-snug text-slate-700";
          text.textContent = offer.detail;
          item.append(text);
        }

        // El contacto es obligatorio en esta tabla, así que el CTA siempre va.
        const wa = whatsappUrl(offer.contactPhone);
        const call = document.createElement("a");
        call.className =
          "mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white no-underline shadow-sm transition hover:bg-emerald-700";
        call.href = wa ?? telUrl(offer.contactPhone);
        if (wa) {
          call.target = "_blank";
          call.rel = "noopener noreferrer";
        }
        call.textContent = `${offer.contactName} — ${offer.contactPhone}`;
        item.append(call);

        const row = document.createElement("div");
        row.className = "mt-2 flex items-center gap-2";
        row.append(assignSelect(offer.id, offer.reportId));

        const pointName = offer.reportId ? names.get(offer.reportId) : undefined;
        if (pointName) {
          const link = document.createElement("button");
          link.type = "button";
          link.className = "shrink-0 text-xs font-medium text-slate-500 hover:text-red-600";
          link.textContent = "↦ Ver punto";
          link.addEventListener("click", () => {
            const report = getReports().find((r) => r.id === offer.reportId);
            if (!report) return;
            closeSheet();
            void flyTo(report.lat, report.lng);
          });
          row.append(link);
        }

        item.append(row);
        return item;
      }),
    );
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();

    // Espejo de los CHECK de la base: título 3–80, nombre 2–60, teléfono con el
    // mismo patrón. Validar dos veces es a propósito.
    const text = title.value.trim();
    if (text.length < 3) {
      showError(error, "Escribe qué tienes disponible (mínimo 3 caracteres).");
      return;
    }

    const who = contactName.value.trim();
    const phone = contactPhone.value.trim();
    if (who.length < 2) {
      showError(error, "Escribe tu nombre: sin él nadie sabe por quién preguntar.");
      return;
    }
    if (!isValidPhone(phone)) {
      showError(error, "Escribe un teléfono válido, con indicativo si es fijo.");
      return;
    }
    clearError(error);

    addOffer({
      title: text,
      detail: detail.value.trim() || null,
      category: category.value || null,
      contactName: who,
      contactPhone: phone,
    });

    title.value = "";
    detail.value = "";
    category.value = "";
  });

  const scheduled = scheduleRender(renderList);
  onOffers(scheduled);
  // Un reporte nuevo agrega un destino a cada selector, y uno borrado le quita
  // el nombre a la oferta que lo apuntaba.
  onChange(scheduled);

  renderList();
}
