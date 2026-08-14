import {
  addVolunteer,
  getVolunteers,
  onVolunteers,
  removeVolunteer,
} from "../data/mental-health";
import { isMine } from "../data/session";
import {
  buildContactCta,
  buildInstagramCta,
  instagramHandle,
  isValidInstagram,
  isValidPhone,
} from "../ui/contact";
import { $, clearError, scheduleRender, showError } from "../ui/dom";
import { paintTime } from "../ui/time";

/** Cuántas inscripciones se ven antes de «Ver más». */
const PAGE = 10;

export function initMentalHealthPanel(): void {
  const form = $<HTMLFormElement>("mental-form");
  const name = $<HTMLInputElement>("mental-name");
  const phone = $<HTMLInputElement>("mental-phone");
  const instagram = $<HTMLInputElement>("mental-instagram");
  const notes = $<HTMLTextAreaElement>("mental-notes");
  const error = $<HTMLParagraphElement>("mental-error");
  const list = $<HTMLUListElement>("mental-list");
  const empty = $<HTMLParagraphElement>("mental-empty");
  const total = $<HTMLSpanElement>("mental-count");
  const more = $<HTMLButtonElement>("mental-more");
  const card = $<HTMLElement>("mental-panel-card");
  const toggle = $<HTMLButtonElement>("mental-toggle");
  const caret = $<HTMLSpanElement>("mental-caret");
  let limit = PAGE;

  more.addEventListener("click", () => {
    limit += PAGE;
    renderList();
  });

  function renderList() {
    const volunteers = getVolunteers();
    total.textContent = String(volunteers.length);
    empty.classList.toggle("hidden", volunteers.length > 0);
    more.classList.toggle("hidden", volunteers.length <= limit);

    list.replaceChildren(
      ...volunteers.slice(0, limit).map((volunteer) => {
        const item = document.createElement("li");
        item.className =
          "rounded-lg border border-slate-200 bg-white px-3 py-5 space-y-5";

        const head = document.createElement("div");
        head.className = "flex items-start justify-between gap-2";

        const who = document.createElement("p");
        who.className = "text-sm font-semibold text-slate-900";
        who.textContent = volunteer.name;
        head.append(who);

        if (isMine(volunteer)) {
          const del = document.createElement("button");
          del.type = "button";
          del.className =
            "shrink-0 text-xs font-medium text-slate-400 transition hover:text-red-600";
          del.textContent = "Retirar";
          del.addEventListener("click", () => removeVolunteer(volunteer.id));
          head.append(del);
        }

        const time = document.createElement("span");
        time.className = "mt-1 block text-xs text-slate-400";
        paintTime(time, volunteer.createdAt);

        item.append(head, time);

        if (volunteer.notes) {
          const text = document.createElement("p");
          text.className = "mt-1 text-sm leading-snug text-slate-700";
          text.textContent = volunteer.notes;
          item.append(text);
        }

        // Los dos cuando hay los dos: el CHECK de la base garantiza que al
        // menos uno esté, así que la ficha nunca queda sin manera de responder.
        if (volunteer.contactPhone) {
          const call = buildContactCta(volunteer.name, volunteer.contactPhone);
          call.classList.add("mt-2");
          item.append(call);
        }

        if (volunteer.contactInstagram) {
          const profile = buildInstagramCta(volunteer.contactInstagram);
          profile.classList.add("mt-2");
          item.append(profile);
        }

        return item;
      }),
    );
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();

    const who = name.value.trim();
    const tel = phone.value.trim();
    const handle = instagram.value.trim();

    if (who.length < 2) {
      showError(error, "Escribe tu nombre: sin él nadie sabe por quién preguntar.");
      return;
    }
    if (!tel && !handle) {
      showError(error, "Deja un WhatsApp o un Instagram para que puedan escribirte.");
      return;
    }
    if (tel && !isValidPhone(tel)) {
      showError(error, "Escribe un teléfono válido, con indicativo si es fijo.");
      return;
    }
    if (handle && !isValidInstagram(handle)) {
      showError(error, "Escribe un usuario de Instagram válido. Ej: @nombre.apellido");
      return;
    }
    clearError(error);

    addVolunteer({
      name: who,
      contactPhone: tel || null,
      // Normalizado acá y no en la ficha: la base guarda el handle a secas, que
      // es lo que el CHECK acepta y lo que arma la url.
      contactInstagram: handle ? instagramHandle(handle) : null,
      notes: notes.value.trim() || null,
    });

    name.value = "";
    phone.value = "";
    instagram.value = "";
    notes.value = "";
  });

  onVolunteers(scheduleRender(renderList));

  // El acordeón es solo de escritorio y arranca cerrado, como las otras dos
  // tarjetas: la barra lateral abre en el mapa, no en un formulario. La regla
  // vive detrás del `lg`, así que en móvil `data-collapsed` no hace nada.
  card.dataset.collapsed = "true";
  toggle.addEventListener("click", () => {
    const open = card.dataset.collapsed === "true";
    card.dataset.collapsed = String(!open);
    toggle.setAttribute("aria-expanded", String(open));
    caret.textContent = open ? "▴" : "▾";
  });

  renderList();
}
