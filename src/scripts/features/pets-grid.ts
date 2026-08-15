import {
  getPets,
  getPetsState,
  onPets,
  onPetsState,
  type Pet,
  type PetKind,
  type PetSex,
} from "../data/pets";
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
  dog: { label: "Perro", chip: "border-amber-800 bg-amber-100 text-amber-800" },
  cat: {
    label: "Gato",
    chip: "border-violet-800 bg-violet-100 text-violet-800",
  },
  other: {
    label: "Otra",
    chip: "border-slate-700 bg-slate-100 text-slate-700",
  },
};

const SEXES: Record<PetSex, { label: string; chip: string }> = {
  male: { label: "Macho", chip: "border-sky-800 bg-sky-100 text-sky-800" },
  female: {
    label: "Hembra",
    chip: "border-pink-800 bg-pink-100 text-pink-800",
  },
};

/** Esta página se lee en un celular y a un brazo de distancia: los chips van en
 *  el tamaño del cuerpo del texto, no en el de una nota al pie. */
const CHIP = "rounded-full border px-2.5 py-0.5 text-sm font-medium";

function kindOf(pet: Pet) {
  return KINDS[pet.kind] ?? KINDS.other;
}

/** Sin sexo no hay chip: quien la encontró no supo decirlo, o la publicó antes
 *  de que se preguntara. Un «no sé» pintado no le sirve a nadie. */
function sexOf(pet: Pet) {
  return pet.sex ? (SEXES[pet.sex] ?? null) : null;
}

function buildChip(pet: Pet): HTMLSpanElement {
  const chip = document.createElement("span");
  chip.className = `${CHIP} ${kindOf(pet).chip}`;
  chip.textContent = kindOf(pet).label;
  return chip;
}

function buildSexChip(pet: Pet): HTMLSpanElement | null {
  const sex = sexOf(pet);
  if (!sex) return null;
  const chip = document.createElement("span");
  chip.className = `${CHIP} ${sex.chip}`;
  chip.textContent = sex.label;
  return chip;
}

/** Los dos chips en el orden en que se leen, y sin huecos cuando falta el sexo. */
function buildChips(pet: Pet): HTMLSpanElement[] {
  const sex = buildSexChip(pet);
  return sex ? [buildChip(pet), sex] : [buildChip(pet)];
}

/**
 * La tarjeta y la ficha piden dos tamaños distintos del mismo objeto, y esa es
 * la idea: la tarjeta pinta un cuadrado del tamaño de un dedo y no tiene por qué
 * bajarse la foto entera, que sale de WhatsApp en 1200×1600. Los bytes grandes
 * los paga quien toca.
 */
function buildPhoto(
  pet: Pet,
  url: string,
  className: string,
): HTMLImageElement {
  const photo = document.createElement("img");
  photo.src = url;
  const sex = sexOf(pet);
  photo.alt = sex
    ? `${kindOf(pet).label} ${sex.label.toLowerCase()} encontrado`
    : `${kindOf(pet).label} encontrada`;
  photo.className = className;
  photo.loading = "lazy";
  photo.decoding = "async";
  return photo;
}

/** La ficha del panel de abajo: la foto grande, cuándo apareció y a quién escribirle. */
function buildDetail(pet: Pet): HTMLElement {
  const detail = document.createElement("div");
  detail.className = "space-y-3";

  detail.append(
    buildPhoto(
      pet,
      pet.photoUrl,
      "max-h-[50svh] w-full rounded-xl object-contain",
    ),
  );

  // Cuándo apareció va arriba y solo: es lo primero que decide si vale la pena
  // escribir —un perro visto hace tres días ya no está donde lo vieron— y
  // metido entre los chips se leía como un tercer chip descolorido.
  const when = document.createElement("p");
  when.className = "text-sm text-slate-500";
  paintTime(when, pet.createdAt, "Encontrada ");

  const meta = document.createElement("div");
  meta.className = "flex flex-wrap items-center gap-2";
  meta.append(...buildChips(pet));

  detail.append(when, meta, buildPhoneCta(pet.contactPhone));
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
      state === "loading"
        ? "Cargando mascotas…"
        : "Todavía no hay mascotas publicadas.";
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
        footer.className =
          "flex flex-col items-start justify-between gap-4 p-3";
        const when = document.createElement("span");
        when.className = "text-xs text-slate-400";
        paintTime(when, pet.createdAt);
        // Los chips van juntos en su propia caja: con `justify-between` sobre
        // tres hijos el sexo se iría al centro, lejos de la clase de animal.
        const chips = document.createElement("div");
        chips.className = "flex flex-wrap items-center gap-1";
        chips.append(...buildChips(pet));
        footer.append(chips, when);

        card.append(
          buildPhoto(pet, pet.thumbUrl, "aspect-square w-full object-cover"),
          footer,
        );
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
