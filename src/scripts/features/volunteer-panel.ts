import { isMine } from "../data/session";
import {
  addVolunteer,
  getVolunteers,
  onVolunteers,
  removeVolunteer,
} from "../data/volunteers";
import { initAccordion } from "../ui/accordion";
import { createChipGroup } from "../ui/chip-group";
import { CHIP_SHAPE } from "../ui/chips";
import {
  instagramHandle,
  isValidInstagram,
  isValidPhone,
} from "@/lib/contact";
import { buildContactCta, buildInstagramCta } from "@/scripts/ui/contact";
import { $, clearError, scheduleRender, showError } from "../ui/dom";
import { paintTime } from "../ui/time";
import {
  DEFAULT_VOLUNTEER_KIND,
  matchesVolunteerFilter,
  VOLUNTEER_KIND_CHIPS,
  volunteerLabel,
  type VolunteerKind,
} from "../volunteers";

const PAGE = 10;

/**
 * One panel for every trade. The form asks which one, the chips over the roster
 * narrow it, and the copy that used to differ between panels — the notes
 * placeholder — now follows the select.
 */
export function initVolunteerPanel(): void {
  const form = $<HTMLFormElement>("volunteer-form");
  const kind = $<HTMLSelectElement>("volunteer-kind");
  const name = $<HTMLInputElement>("volunteer-name");
  const phone = $<HTMLInputElement>("volunteer-phone");
  const instagram = $<HTMLInputElement>("volunteer-instagram");
  const notes = $<HTMLTextAreaElement>("volunteer-notes");
  const error = $<HTMLParagraphElement>("volunteer-error");
  const filter = $<HTMLDivElement>("volunteer-filter");
  const list = $<HTMLUListElement>("volunteer-list");
  const empty = $<HTMLParagraphElement>("volunteer-empty");
  const total = $<HTMLSpanElement>("volunteer-count");
  const more = $<HTMLButtonElement>("volunteer-more");
  let limit = PAGE;

  const chips = createChipGroup<VolunteerKind>(filter, {
    attribute: "volunteer-kind-filter",
    chips: VOLUNTEER_KIND_CHIPS,
    selected: [],
    onChange: () => {
      limit = PAGE;
      renderList();
    },
  });

  function selectedKind(): VolunteerKind {
    return kind.value as VolunteerKind;
  }

  kind.addEventListener("change", () => {
    notes.placeholder = volunteerLabel(selectedKind()).notesPlaceholder;
  });

  more.addEventListener("click", () => {
    limit += PAGE;
    renderList();
  });

  function renderList() {
    const all = getVolunteers();
    const marked = chips.selected();
    const volunteers = all.filter((volunteer) =>
      matchesVolunteerFilter(volunteer.kind, marked),
    );

    total.textContent = String(all.length);
    empty.textContent =
      all.length > 0
        ? "Nadie se ha inscrito en lo que estás filtrando."
        : "Todavía nadie se ha inscrito.";
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

        const label = volunteerLabel(volunteer.kind);
        const trade = document.createElement("span");
        trade.className = `${CHIP_SHAPE} ${label.chip} mt-1 inline-block`;
        trade.textContent = label.label;

        const time = document.createElement("span");
        time.className = "mt-1 block text-xs text-slate-400";
        paintTime(time, volunteer.createdAt);

        item.append(head, trade, time);

        if (volunteer.notes) {
          const text = document.createElement("p");
          text.className = "mt-1 text-sm leading-snug text-slate-700";
          text.textContent = volunteer.notes;
          item.append(text);
        }

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
      kind: selectedKind(),
      name: who,
      contactPhone: tel || null,

      contactInstagram: handle ? instagramHandle(handle) : null,
      notes: notes.value.trim() || null,
    });

    kind.value = DEFAULT_VOLUNTEER_KIND;
    notes.placeholder = volunteerLabel(DEFAULT_VOLUNTEER_KIND).notesPlaceholder;
    name.value = "";
    phone.value = "";
    instagram.value = "";
    notes.value = "";
  });

  onVolunteers(scheduleRender(renderList));
  initAccordion("volunteer");
  renderList();
}
