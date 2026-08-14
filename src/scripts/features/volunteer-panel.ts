import { isMine } from "../data/session";
import { volunteerStore } from "../data/volunteers";
import { initAccordion } from "../ui/accordion";
import {
  buildContactCta,
  buildInstagramCta,
  instagramHandle,
  isValidInstagram,
  isValidPhone,
} from "../ui/contact";
import { $, clearError, scheduleRender, showError } from "../ui/dom";
import { paintTime } from "../ui/time";
import { VOLUNTEER_PANELS, type VolunteerPanel } from "../volunteers";

/** How many signups are shown before «Ver más». */
const PAGE = 10;

/**
 * One panel per kind of volunteer, all of them the same: the form on top, the
 * list below. What changes between them is the copy, and that lives in
 * `scripts/volunteers.ts` — this only reads it.
 */
function createVolunteerPanel(panel: VolunteerPanel): void {
  const { getVolunteers, onVolunteers, addVolunteer, removeVolunteer } =
    volunteerStore(panel.kind);

  const form = $<HTMLFormElement>(`${panel.prefix}-form`);
  const name = $<HTMLInputElement>(`${panel.prefix}-name`);
  const phone = $<HTMLInputElement>(`${panel.prefix}-phone`);
  const instagram = $<HTMLInputElement>(`${panel.prefix}-instagram`);
  const notes = $<HTMLTextAreaElement>(`${panel.prefix}-notes`);
  const error = $<HTMLParagraphElement>(`${panel.prefix}-error`);
  const list = $<HTMLUListElement>(`${panel.prefix}-list`);
  const empty = $<HTMLParagraphElement>(`${panel.prefix}-empty`);
  const total = $<HTMLSpanElement>(`${panel.prefix}-count`);
  const more = $<HTMLButtonElement>(`${panel.prefix}-more`);
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
        who.className = "text-base font-semibold text-slate-900";
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

        // Both when there are both: the CHECK in the database guarantees at
        // least one of them, so a card is never left with no way to answer.
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
      showError(
        error,
        "Escribe tu nombre: sin él nadie sabe por quién preguntar.",
      );
      return;
    }
    if (!tel && !handle) {
      showError(
        error,
        "Deja un WhatsApp o un Instagram para que puedan escribirte.",
      );
      return;
    }
    if (tel && !isValidPhone(tel)) {
      showError(
        error,
        "Escribe un teléfono válido, con indicativo si es fijo.",
      );
      return;
    }
    if (handle && !isValidInstagram(handle)) {
      showError(
        error,
        "Escribe un usuario de Instagram válido. Ej: @nombre.apellido",
      );
      return;
    }
    clearError(error);

    addVolunteer({
      name: who,
      contactPhone: tel || null,
      // Normalised here and not in the card: the database saves the bare
      // handle, which is what the CHECK accepts and what builds the url.
      contactInstagram: handle ? instagramHandle(handle) : null,
      notes: notes.value.trim() || null,
    });

    name.value = "";
    phone.value = "";
    instagram.value = "";
    notes.value = "";
  });

  onVolunteers(scheduleRender(renderList));
  initAccordion(panel.prefix);
  renderList();
}

export function initVolunteerPanels(): void {
  for (const panel of VOLUNTEER_PANELS) createVolunteerPanel(panel);
}
