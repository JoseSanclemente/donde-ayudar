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
import {
  buildInstagramPostCta,
  buildPhoneCta,
  buildUsernameCta,
} from "../ui/contact";
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
 * Where the animal is, when it is somewhere with a name. Most rows have none —
 * whoever picks a dog up in the street keeps it at home — and then there is no
 * line at all: an empty row under the chips reads as a missing fact. Two lines
 * at most, so the name of a vet cannot stretch the card past the one beside it.
 */
function buildPlace(pet: Pet): HTMLParagraphElement | null {
  if (!pet.placeName) return null;
  const place = document.createElement("p");
  place.className = "line-clamp-2 text-sm text-slate-600";
  place.textContent = pet.placeName;
  return place;
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

/**
 * El marco de la foto de la ficha, con su altura puesta de antemano y la ruedita
 * girando debajo. Los 800×800 de la ficha son una transformación aparte de la
 * que ya se bajó para la tarjeta: se piden recién al tocar, y hasta que
 * contestan la `img` no mide nada. Sin marco el panel abría del alto de los
 * chips y daba un salto cuando llegaban los bytes, justo encima del botón de
 * contacto, que es lo único que hay que tocar ahí.
 *
 * La ruedita es la misma de `mascotas.astro`, clase por clase: dos esperas de la
 * misma página no tienen por qué verse distinto.
 */
const PHOTO_FRAME =
  "relative flex h-[50svh] w-full items-center justify-center overflow-hidden rounded-xl bg-slate-100";
const PHOTO_SPINNER =
  "h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-red-600";

function buildDetailPhoto(pet: Pet): HTMLDivElement {
  const frame = document.createElement("div");
  frame.className = PHOTO_FRAME;

  const spinner = document.createElement("span");
  spinner.className = PHOTO_SPINNER;
  spinner.setAttribute("aria-hidden", "true");

  const photo = buildPhoto(
    pet,
    pet.photoUrl,
    "absolute inset-0 h-full w-full object-contain opacity-0 transition-opacity duration-300",
  );
  // La ficha se abre porque alguien la tocó: la foto es lo que vino a ver y no
  // hay nada más abajo que pueda entrar antes.
  photo.loading = "eager";

  // Que falle también termina la espera. Una ruedita que gira para siempre dice
  // «ya casi» de una foto que no va a llegar.
  const settle = () => {
    spinner.remove();
    photo.classList.replace("opacity-0", "opacity-100");
  };
  photo.addEventListener("load", settle);
  photo.addEventListener("error", () => spinner.remove());
  // Una foto que ya está en caché puede completarse antes de que se escuche el
  // `load`, y entonces el evento no vuelve a dispararse.
  if (photo.complete && photo.naturalWidth > 0) settle();

  frame.append(spinner, photo);
  return frame;
}

/**
 * The button of a pet. The contact is one of the three and never several:
 * somebody who hides their number behind a WhatsApp username has no phone to
 * publish, and `wa.me` opens that chat just the same, so the first two buttons
 * read alike because they do the same thing. The third does not: a pet that came
 * off Instagram is reached at the post it appeared in, and the button wears
 * another colour so two identical buttons never leave it unsaid which app opens.
 * `null` from all three is a row the store does not accept, so there is nothing
 * to draw for it.
 */
function buildPetCta(pet: Pet): HTMLAnchorElement | null {
  if (pet.contactPhone) return buildPhoneCta(pet.contactPhone);
  if (pet.contactUsername) return buildUsernameCta(pet.contactUsername);
  if (pet.contactInstagramUrl)
    return buildInstagramPostCta(pet.contactInstagramUrl);
  return null;
}

/** La ficha del panel de abajo: la foto grande, cuándo apareció y a quién escribirle. */
function buildDetail(pet: Pet): HTMLElement {
  const detail = document.createElement("div");
  detail.className = "space-y-3";

  detail.append(buildDetailPhoto(pet));

  // Cuándo apareció va arriba y solo: es lo primero que decide si vale la pena
  // escribir —un perro visto hace tres días ya no está donde lo vieron— y
  // metido entre los chips se leía como un tercer chip descolorido.
  const when = document.createElement("p");
  when.className = "text-sm text-slate-500";
  paintTime(when, pet.createdAt, "Encontrada ");

  const meta = document.createElement("div");
  meta.className = "flex flex-wrap items-center gap-2";
  meta.append(...buildChips(pet));

  const place = buildPlace(pet);
  const cta = buildPetCta(pet);
  detail.append(
    when,
    meta,
    ...(place ? [place] : []),
    ...(cta ? [cta] : []),
  );
  return detail;
}

/**
 * `h-full` on a grid child, and the grid stretches its rows: two cards side by
 * side measure the same even when one has no place and the other carries two
 * lines of vet name. Without it the shorter footer shrank its card and the row
 * came out stepped.
 */
const CARD =
  "flex h-full w-full flex-col overflow-hidden rounded-xl border border-slate-200 bg-white text-left shadow-sm transition";

/** Cuándo apareció y de qué clase es: el pie de la tarjeta, en los dos anchos. */
function buildCardFooter(pet: Pet): HTMLDivElement {
  const footer = document.createElement("div");
  // `flex-1` takes the slack of the stretched card, and `justify-between` keeps
  // the time at the bottom of it: across a row of uneven cards the time lands at
  // the same height in all of them.
  footer.className =
    "flex flex-1 flex-col items-start justify-between gap-4 p-3";
  const when = document.createElement("span");
  when.className = "text-xs text-slate-400";
  paintTime(when, pet.createdAt);
  // Los chips van juntos en su propia caja: con `justify-between` sobre tres
  // hijos el sexo se iría al centro, lejos de la clase de animal.
  const chips = document.createElement("div");
  chips.className = "flex flex-wrap items-center gap-1";
  chips.append(...buildChips(pet));
  // The place sits against the chips and not loose between them and the time:
  // the `gap-4` of the footer separates two blocks, and as a third child the
  // name floated the same distance from everything.
  const head = document.createElement("div");
  head.className = "flex flex-col items-start gap-1.5";
  const place = buildPlace(pet);
  head.append(chips, ...(place ? [place] : []));
  footer.append(head, when);
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
  const cta = buildPetCta(pet);
  if (cta) body.append(cta);
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
