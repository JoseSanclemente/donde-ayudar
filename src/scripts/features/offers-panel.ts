import {
  addOffer,
  getOffers,
  onOffers,
  removeOffer,
  setOfferFinished,
} from "../data/offers";
import { getReports, onChange } from "../data/reports";
import { isMine } from "../data/session";
import { flyTo } from "../map";
import { categoryChip, categoryTitle } from "../resources";
import { closeSheet, setTabDot } from "../sheet";
import { initAccordion } from "../ui/accordion";
import { CHIP_SHAPE } from "../ui/chips";
import { buildContactCta, isValidPhone } from "../ui/contact";
import { $, clearError, scheduleRender, showError } from "../ui/dom";
import { paintTime } from "../ui/time";

/** Cuántas ofertas se ven antes de «Ver más». */
const PAGE = 10;

/** Panel al que apunta el punto de «hay ayuda sin despachar». */
const TAB = "ayuda";

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

  /**
   * The communal "this one is done" box: no `isMine` gate, the same way anyone
   * can mark a resource covered. No confirmation either — it is cheap, and
   * anyone can untick it.
   */
  function finishedBox(offerId: string, finished: boolean): HTMLLabelElement {
    const label = document.createElement("label");
    label.className =
      "flex cursor-pointer items-center gap-2 text-xs font-medium text-slate-500";

    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = finished;
    box.className =
      "h-4 w-4 shrink-0 rounded border-slate-300 text-red-600 accent-red-600 focus:ring-red-300";
    box.addEventListener("change", () => {
      setOfferFinished(offerId, box.checked);
    });

    label.append(box, document.createTextNode("Finalizada"));
    return label;
  }

  function renderList() {
    const offers = getOffers();
    const available = offers.filter(
      (offer) => !offer.reportId && !offer.finishedAt,
    ).length;
    // Cuenta lo que todavía se puede mover: una oferta ya despachada no es
    // capacidad disponible.
    total.textContent = String(available);
    // Unlike the «Novedades» dot, this one is not an unread mark: it flags help
    // still waiting for a destination, so opening the tab does not clear it.
    setTabDot(TAB, available > 0);
    empty.classList.toggle("hidden", offers.length > 0);
    more.classList.toggle("hidden", offers.length <= limit);

    const names = new Map(
      getReports().map((report) => [report.id, report.name]),
    );

    list.replaceChildren(
      ...offers.slice(0, limit).map((offer) => {
        const item = document.createElement("li");
        item.className = `rounded-lg border px-3 py-5 space-y-5 ${
          offer.finishedAt
            ? "border-slate-200 bg-slate-50 opacity-60"
            : offer.reportId
              ? "border-slate-200 bg-slate-50"
              : "border-slate-200 bg-white"
        }`;

        const head = document.createElement("div");
        head.className = "flex items-start justify-between gap-2";

        const name = document.createElement("p");
        name.className = offer.finishedAt
          ? "text-sm font-semibold text-slate-500 line-through"
          : "text-sm font-semibold text-slate-900";
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
          chip.textContent = categoryTitle(offer.category);
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
        const call = buildContactCta(offer.contactName, offer.contactPhone);
        call.classList.add("mt-2");
        item.append(call);

        const row = document.createElement("div");
        row.className = "mt-2 flex items-center justify-between gap-2";
        row.append(finishedBox(offer.id, offer.finishedAt !== null));

        const pointName = offer.reportId
          ? names.get(offer.reportId)
          : undefined;
        if (pointName) {
          const link = document.createElement("button");
          link.type = "button";
          link.className =
            "shrink-0 text-xs font-medium text-slate-500 hover:text-red-600";
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
      showError(
        error,
        "Escribe tu nombre: sin él nadie sabe por quién preguntar.",
      );
      return;
    }
    if (!isValidPhone(phone)) {
      showError(
        error,
        "Escribe un teléfono válido, con indicativo si es fijo.",
      );
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
  // A deleted report takes the name away from the offer pointing at it, so the
  // «↦ Ver punto» button has to be repainted too.
  onChange(scheduled);

  initAccordion("offers");

  renderList();
}
