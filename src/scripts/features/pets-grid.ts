import {
  fetchPetContact,
  getPetContact,
  getPets,
  getPetsState,
  onPets,
  onPetsState,
  type Pet,
  type PetContact,
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
  buildPendingCta,
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

/**
 * La ficha de una mascota, como dirección. No hay una página por mascota —el
 * sitio es estático— así que la ficha es un parámetro sobre la cuadrícula, el
 * segundo de esta página después de `lugar`. Es lo que viaja en el WhatsApp de
 * una tanda: quien recibe el mensaje abre la ficha del animal por el que le
 * escriben. Van acá y no en `pets-filter.ts` porque no filtran nada; el arranque
 * los lee para pasárselos a `focusPet`.
 */
export const PET_PATH = "/mascotas";
export const PET_PARAM = "mascota";

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
function buildPlace(pet: Pet): HTMLDivElement | null {
  if (!pet.placeName) return null;
  const block = document.createElement("div");
  const label = document.createElement("p");
  label.className = "text-xs font-medium text-slate-400";
  label.textContent = "¿Dónde fue visto?";
  const place = document.createElement("p");
  place.className = "line-clamp-2 text-sm text-slate-600";
  place.textContent = pet.placeName;
  block.append(label, place);
  return block;
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
 * The button of a pet, once its contact is known. The contact is one of the
 * three and never several: somebody who hides their number behind a WhatsApp
 * username has no phone to publish, and `wa.me` opens that chat just the same,
 * so the first two buttons read alike because they do the same thing. The third
 * does not: a pet that came off Instagram is reached at the post it appeared in,
 * and the button wears another colour so two identical buttons never leave it
 * unsaid which app opens.
 */
function buildContactCta(pet: Pet, contact: PetContact): HTMLAnchorElement {
  const message = petMessage(pet);
  if (contact.phone) return buildPhoneCta(contact.phone, message);
  if (contact.username) return buildUsernameCta(contact.username, message);
  return buildInstagramPostCta(contact.instagramUrl ?? "");
}

/** El destino ya resuelto, abierto sin depender de un `click` sintético: un
 *  `target="_blank"` después de una espera lo bloquean varios navegadores. */
function openContact(url: string): void {
  if (!window.open(url, "_blank", "noopener")) location.href = url;
}

/**
 * El botón de una mascota, que al pintarse todavía no sabe a dónde lleva.
 *
 * El contacto ya no viaja con la lista —doscientas filas eran doscientos
 * teléfonos en una sola respuesta— así que se pide de a uno. Cuándo se pide es
 * lo único que cambia entre los dos anchos: la ficha de móvil se abre porque
 * alguien tocó esa mascota y el contacto es lo que vino a buscar, así que se
 * pide de una; la tarjeta de escritorio está en una cuadrícula de veinte y
 * pedirlo al pintar sería exactamente lo que se quitó, así que espera al mouse
 * o al tabulador, que es lo que pasa siempre antes de un clic.
 *
 * Tocar antes de que llegue no se pierde: el botón resuelve y abre. Y si no
 * llega —sin conexión, la mascota retirada mientras se miraba— se queda como
 * está, que es lo que un botón que no puede cumplir tiene que hacer.
 */
function buildPetCta(pet: Pet, eager: boolean, hover?: HTMLElement): HTMLElement {
  const known = getPetContact(pet.id);
  if (known) return buildContactCta(pet, known);

  const pending = buildPendingCta();
  let asked: Promise<PetContact | null> | null = null;

  // Una sola petición por mascota por más veces que se pase el mouse: la
  // promesa se guarda, no el hecho de haber preguntado.
  const resolve = () => (asked ??= fetchPetContact(pet.id));

  const settle = async (): Promise<HTMLAnchorElement | null> => {
    const contact = await resolve();
    if (!contact || !pending.isConnected) return null;
    const cta = buildContactCta(pet, contact);
    pending.replaceWith(cta);
    return cta;
  };

  pending.addEventListener("focus", () => void settle());
  pending.addEventListener("click", () => {
    void settle().then((cta) => cta && openContact(cta.href));
  });
  // La tarjeta entera y no solo el botón: el mouse llega al borde de arriba
  // mucho antes que al botón del pie, y el de Instagram cambia de color al
  // resolverse — que lo haga mientras se lee la foto y no bajo el dedo.
  (hover ?? pending).addEventListener("pointerenter", () => void settle());

  if (eager) void settle();
  return pending;
}

/**
 * El primer mensaje ya escrito, para las mascotas de una tanda: todas comparten
 * un mismo chat, así que quien lo recibe no tiene con qué distinguir veinte
 * mensajes sobre veinte animales. El código es el que ya usa en su propio
 * registro, y el enlace abre esta misma ficha —`wa.me` no lleva adjuntos, solo
 * texto, así que la foto solo puede viajar como dirección.
 *
 * Without a code there is no register and no card to link to, so the message is
 * only the reason for writing: whoever published from the form answers about
 * their own pet and needs nothing to tell it apart.
 */
function petMessage(pet: Pet): string {
  if (!pet.refCode)
    return "Hola, escribo por la mascota que vi en dondeayudar.com.co";
  const link = `${location.origin}${PET_PATH}?${PET_PARAM}=${encodeURIComponent(pet.refCode)}`;
  return `Hola, escribo por la mascota ${pet.refCode} que vi en dondeayudar.com.co:\n${link}`;
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
  // La ficha se abrió porque alguien tocó esta mascota: el contacto es lo que
  // vino a buscar y no hay a qué esperar.
  const cta = buildPetCta(pet, true);
  detail.append(when, meta, ...(place ? [place] : []), cta);
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
  body.append(buildPetCta(pet, false, card));
  card.append(
    buildPhoto(pet, pet.thumbUrl, "aspect-square w-full object-cover"),
    buildCardFooter(pet),
    body,
  );
  return card;
}

export type PetsGrid = {
  setFilter(next: PetsFilter): void;
  /**
   * Llevar a quien llega desde un mensaje hasta la mascota por la que escriben.
   * En móvil es abrir la ficha, que es lo mismo que hace tocar la tarjeta; en
   * escritorio no hay ficha que abrir —la tarjeta ya lleva su propio botón— así
   * que la trae a la vista y la marca un momento. Un código que no existe (una
   * mascota ya retirada, un enlace viejo) no hace nada.
   */
  focusPet(refCode: string): void;
};

/** El anillo que dice cuál es, y cuánto dura antes de devolver la tarjeta a la
 *  fila. Las clases van literales: el escáner de Tailwind lee esto como texto. */
const FOCUS_RING = ["ring-2", "ring-red-500", "ring-offset-2", "rounded-xl"];
const FOCUS_MS = 2600;

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

        // Lo que `focusPet` busca en la cuadrícula ya pintada.
        item.dataset.petId = pet.id;
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

    focusPet(refCode) {
      const pet = getPets().find((candidate) => candidate.refCode === refCode);
      if (!pet) return;

      if (isMobile()) {
        openPetSheet(buildDetail(pet));
        return;
      }

      // El repintado de la cuadrícula está encolado en un `requestAnimationFrame`
      // (`scheduleRender`), así que la tarjeta de una mascota que acaba de
      // llegar todavía no está en el DOM: esto va después de ese cuadro. Si el
      // filtro la esconde no hay a dónde ir, y no se toca el filtro por eso.
      requestAnimationFrame(() => {
        const item = grid.querySelector<HTMLLIElement>(
          `[data-pet-id="${CSS.escape(pet.id)}"]`,
        );
        if (!item) return;
        item.scrollIntoView({ behavior: "smooth", block: "center" });
        item.classList.add(...FOCUS_RING);
        setTimeout(() => item.classList.remove(...FOCUS_RING), FOCUS_MS);
      });
    },
  };
}
