import {
  getPets,
  getPetsState,
  onPets,
  onPetsState,
  type Pet,
} from "../data/pets";
import {
  DEFAULT_PETS_FILTER,
  matchesPetsFilter,
  PET_KINDS,
  PET_SEXES,
  type PetsFilter,
} from "../pets-filter";
import { openPetSheet } from "../pet-sheet";
import { isMobile, onBreakpointChange } from "../ui/breakpoint";
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

/** Esta página se lee en un celular y a un brazo de distancia: los chips van en
 *  el tamaño del cuerpo del texto, no en el de una nota al pie. */
const CHIP = "rounded-full border px-2.5 py-0.5 text-sm font-medium";

function kindOf(pet: Pet) {
  return PET_KINDS[pet.kind] ?? PET_KINDS.other;
}

/** Sin sexo no hay chip: quien la encontró no supo decirlo, o la publicó antes
 *  de que se preguntara. Un «no sé» pintado no le sirve a nadie. */
function sexOf(pet: Pet) {
  return pet.sex ? (PET_SEXES[pet.sex] ?? null) : null;
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

const CARD =
  "w-full overflow-hidden rounded-xl border border-slate-200 bg-white text-left shadow-sm transition";

/** Cuándo apareció y de qué clase es: el pie de la tarjeta, en los dos anchos. */
function buildCardFooter(pet: Pet): HTMLDivElement {
  const footer = document.createElement("div");
  footer.className = "flex flex-col items-start justify-between gap-4 p-3";
  const when = document.createElement("span");
  when.className = "text-xs text-slate-400";
  paintTime(when, pet.createdAt);
  // Los chips van juntos en su propia caja: con `justify-between` sobre tres
  // hijos el sexo se iría al centro, lejos de la clase de animal.
  const chips = document.createElement("div");
  chips.className = "flex flex-wrap items-center gap-1";
  chips.append(...buildChips(pet));
  footer.append(chips, when);
  return footer;
}

/**
 * La tarjeta de móvil: toda ella es el botón que abre la ficha. El blanco
 * alrededor de la foto es la mitad del área que el dedo alcanza, y el teléfono
 * no cabe acá —una fila de tarjetas con un botón verde cada una es una pantalla
 * de botones verdes—, así que el contacto vive una sola vez, en la ficha.
 */
function buildTapCard(pet: Pet): HTMLButtonElement {
  const card = document.createElement("button");
  card.type = "button";
  card.className = `${CARD} hover:border-slate-300`;
  card.addEventListener("click", () => openPetSheet(buildDetail(pet)));
  card.append(
    buildPhoto(pet, pet.thumbUrl, "aspect-square w-full object-cover"),
    buildCardFooter(pet),
  );
  return card;
}

/**
 * La de escritorio: nada que tocar y el WhatsApp a la vista. Con el ratón no hay
 * que ahorrar espacio ni pasos —la cuadrícula ya cabe entera y el panel de abajo
 * era una parada de más para llegar al único dato que importa—, y el CTA es un
 * enlace, que dentro de un botón no sería HTML válido.
 */
function buildOpenCard(pet: Pet): HTMLElement {
  const card = document.createElement("article");
  card.className = CARD;
  const body = document.createElement("div");
  body.className = "px-3 pb-3";
  body.append(buildPhoneCta(pet.contactPhone));
  card.append(
    buildPhoto(pet, pet.thumbUrl, "aspect-square w-full object-cover"),
    buildCardFooter(pet),
    body,
  );
  return card;
}

export type PetsGrid = {
  setFilter(next: PetsFilter): void;
};

export function initPetsGrid(): PetsGrid {
  const grid = $<HTMLUListElement>("pets-grid");
  const panel = $<HTMLDivElement>("pets-state");
  const spinner = $<HTMLSpanElement>("pets-spinner");
  const empty = $<HTMLParagraphElement>("pets-empty");
  const total = $<HTMLSpanElement>("pets-count");

  const entered = new Set<string>();
  let filter: PetsFilter = DEFAULT_PETS_FILTER;

  /**
   * Mientras las mascotas vienen en camino no se puede decir «no hay
   * mascotas»: sería mentira, y quien está buscando a la suya la leería como un
   * no definitivo.
   */
  function paintEmptyState(shown: number, published: number) {
    const { state, message } = getPetsState();
    if (shown > 0 && state !== "error") {
      panel.classList.add("hidden");
      return;
    }
    panel.classList.remove("hidden");
    spinner.hidden = state !== "loading";
    if (state === "error") {
      empty.textContent = message ?? "No se pudieron cargar las mascotas.";
      empty.className = "text-center text-sm text-red-600";
      return;
    }
    empty.className = "text-center text-sm text-slate-500";
    if (state === "loading") {
      empty.textContent = "Cargando mascotas…";
      return;
    }
    // Que las escondió el filtro y que no hay ninguna publicada no son lo
    // mismo: lo primero se arregla tocando un chip, lo segundo no.
    empty.textContent =
      published > 0
        ? "Ninguna mascota coincide con el filtro."
        : "Todavía no hay mascotas publicadas.";
  }

  function render() {
    const published = getPets();
    const pets = published.filter((pet) => matchesPetsFilter(pet, filter));
    total.textContent = String(pets.length);

    let fresh = 0;

    grid.replaceChildren(
      ...pets.map((pet) => {
        const item = document.createElement("li");
        if (!entered.has(pet.id)) {
          entered.add(pet.id);
          item.dataset.enter = "";
          item.style.animationDelay = `${Math.min(fresh, 11) * 0.11}s`;
          fresh += 1;
        }

        item.append(isMobile() ? buildTapCard(pet) : buildOpenCard(pet));
        return item;
      }),
    );

    paintEmptyState(pets.length, published.length);
  }

  const scheduled = scheduleRender(render);
  onPets(scheduled);
  // El estado del store no cambia la lista, pero sí lo que dice el párrafo
  // cuando está vacía: «cargando» y «no hay» no son lo mismo.
  onPetsState(scheduled);
  // Las dos tarjetas son marcado distinto, no una clase que se apague: cruzar el
  // corte hay que rearmarlo.
  onBreakpointChange(scheduled);

  render();

  return {
    setFilter(next) {
      filter = next;
      // Cambiar el filtro rearma la cuadrícula entera, no le agrega una
      // tarjeta: sin olvidar quién ya entró, las que sobreviven aparecerían
      // secas al lado de las que no, y lo que se pierde es justamente la señal
      // de que la lista contestó. Un dato que llega solo sigue animando solo.
      entered.clear();
      scheduled();
    },
  };
}
