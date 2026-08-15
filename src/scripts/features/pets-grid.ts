import { getPets, getPetsState, onPets, onPetsState, type Pet, type PetKind } from "../data/pets";
import { openPetSheet } from "../pet-sheet";
import { buildPhoneCta } from "../ui/contact";
import { $, scheduleRender } from "../ui/dom";
import { paintTime } from "../ui/time";

/**
 * La cuadrícula de mascotas encontradas y su ficha.
 *
 * La tarjeta es la foto y poco más: quien busca a su perro lo reconoce de un
 * vistazo o no, así que lo que la lista tiene que hacer es caber en una pantalla
 * y cargar rápido. El teléfono no se pinta acá — está una sola vez, en la ficha
 * que abre el panel de abajo, que es donde alguien ya decidió que ese es.
 */

/** Las clases van literales: el escáner de Tailwind lee este archivo como texto. */
const KINDS: Record<PetKind, { label: string; chip: string }> = {
  dog: { label: "Perro", chip: "bg-amber-100 text-amber-800" },
  cat: { label: "Gato", chip: "bg-violet-100 text-violet-800" },
  other: { label: "Otra", chip: "bg-slate-100 text-slate-700" },
};

const CHIP = "rounded-full px-2 py-0.5 text-xs font-medium";

function kindOf(pet: Pet) {
  return KINDS[pet.kind] ?? KINDS.other;
}

function buildChip(pet: Pet): HTMLSpanElement {
  const chip = document.createElement("span");
  chip.className = `${CHIP} ${kindOf(pet).chip}`;
  chip.textContent = kindOf(pet).label;
  return chip;
}

/** La foto de la tarjeta y la de la ficha son la misma: una sola descarga. */
function buildPhoto(pet: Pet, className: string): HTMLImageElement {
  const photo = document.createElement("img");
  photo.src = pet.photoUrl;
  photo.alt = `${kindOf(pet).label} encontrada`;
  photo.className = className;
  photo.loading = "lazy";
  photo.decoding = "async";
  return photo;
}

/** La ficha del panel de abajo: la foto grande, cuándo apareció y a quién escribirle. */
function buildDetail(pet: Pet): HTMLElement {
  const detail = document.createElement("div");
  detail.className = "space-y-3";

  detail.append(buildPhoto(pet, "max-h-[50svh] w-full rounded-xl object-contain"));

  const meta = document.createElement("div");
  meta.className = "flex items-center gap-2";
  const when = document.createElement("span");
  when.className = "text-xs text-slate-500";
  paintTime(when, pet.createdAt, "Encontrada ");
  meta.append(buildChip(pet), when);

  const hint = document.createElement("p");
  hint.className = "text-sm leading-snug text-slate-600";
  hint.textContent = "Escríbele a quien la tiene para acordar dónde recogerla.";

  detail.append(meta, hint, buildPhoneCta(pet.contactPhone));
  return detail;
}

export function initPetsGrid(): void {
  const grid = $<HTMLUListElement>("pets-grid");
  const empty = $<HTMLParagraphElement>("pets-empty");
  const total = $<HTMLSpanElement>("pets-count");

  /**
   * Mientras las mascotas vienen en camino no se puede decir «no hay
   * mascotas»: sería mentira, y quien está buscando a la suya la leería como un
   * no definitivo.
   */
  function paintEmptyState(shown: number) {
    const { state, message } = getPetsState();
    if (shown > 0 && state !== "error") {
      empty.classList.add("hidden");
      return;
    }
    empty.classList.remove("hidden");
    if (state === "error") {
      empty.textContent = message ?? "No se pudieron cargar las mascotas.";
      empty.className = "mt-3 text-sm text-red-600";
      return;
    }
    empty.className = "mt-3 text-sm text-slate-500";
    empty.textContent =
      state === "loading" ? "Cargando mascotas…" : "Todavía no hay mascotas publicadas.";
  }

  function render() {
    const pets = getPets();
    total.textContent = String(pets.length);

    grid.replaceChildren(
      ...pets.map((pet) => {
        const item = document.createElement("li");

        // Toda la tarjeta es el botón: en un celular el blanco alrededor de la
        // foto es la mitad del área que el dedo alcanza.
        const card = document.createElement("button");
        card.type = "button";
        card.className =
          "w-full overflow-hidden rounded-xl border border-slate-200 bg-white text-left shadow-sm transition hover:border-slate-300";
        card.addEventListener("click", () => openPetSheet(buildDetail(pet)));

        const footer = document.createElement("div");
        footer.className = "flex items-center justify-between gap-2 px-2 py-2";
        const when = document.createElement("span");
        when.className = "text-xs text-slate-400";
        paintTime(when, pet.createdAt);
        footer.append(buildChip(pet), when);

        card.append(buildPhoto(pet, "aspect-square w-full object-cover"), footer);
        item.append(card);
        return item;
      }),
    );

    paintEmptyState(pets.length);
  }

  const scheduled = scheduleRender(render);
  onPets(scheduled);
  // El estado del store no cambia la lista, pero sí lo que dice el párrafo
  // cuando está vacía: «cargando» y «no hay» no son lo mismo.
  onPetsState(scheduled);

  render();
}
