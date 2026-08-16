import {
  DEFAULT_PETS_FILTER,
  isDefaultPetsFilter,
  PET_KIND_CHIPS,
  PET_SEX_CHIPS,
  NO_PLACE,
  petPlaceOptions,
  type PetPlaceFilter,
  type PetsFilter,
  type PetSexFilter,
} from "../pets-filter";
import {
  getPets,
  getPetsState,
  onPets,
  onPetsState,
  type PetKind,
} from "../data/pets";
import { openPetSheet } from "../pet-sheet";
import { isMobile, onBreakpointChange } from "../ui/breakpoint";
import { createChipGroup } from "../ui/chip-group";
import { $ } from "../ui/dom";

/**
 * The chips of `PetsFilters.astro`.
 *
 * The state lives here and not in a store with an emitter, like in
 * `map-filter.ts`: only the grid consumes it, and `pets.ts` is what hands one to
 * the other — a feature does not import another feature.
 *
 * The panel is the bottom sheet the page already has. `openPetSheet` moves the
 * card into its body, and a moved node keeps its listeners, so the chips are
 * still where they were left the next time the button is tapped.
 */

// Literal, like in `resources.ts`: the Tailwind scanner reads this file as plain
// text and an interpolated class never gets compiled.
const BUTTON_OFF = "border-red-200 bg-red-50 text-red-600 hover:border-red-300 hover:bg-red-100";
const BUTTON_ON = "border-red-600 bg-red-600 text-white hover:border-red-700 hover:bg-red-700";

/**
 * The place travels in the url, so a vet can hand out a link that opens the page
 * already showing its own animals: `/mascotas?lugar=Royi Pets Cañasgordas`, which
 * the browser writes escaped. It is the name itself and not an id, because the
 * name is all a place has — there is no table of places, only the text on each
 * row — and a link a person can read is a link a person can check.
 *
 * Only the place goes in: kind and sex are two taps on chips that are already on
 * screen, and a url carrying the whole filter is a url nobody can read.
 */
const PLACE_PARAM = "lugar";

/** «Sin lugar» is a choice too, and the sentinel is not something to publish. */
const NO_PLACE_PARAM = "sin-lugar";

function placeFromUrl(): PetPlaceFilter {
  const raw = new URLSearchParams(location.search).get(PLACE_PARAM)?.trim();
  if (!raw) return null;
  return raw === NO_PLACE_PARAM ? NO_PLACE : raw;
}

/**
 * `replaceState` and not `pushState`: picking a place is not a page somebody
 * expects the back button to undo one by one. What it is for is the address bar
 * — whatever is on screen is what gets copied out of it.
 */
function placeToUrl(place: PetPlaceFilter): void {
  const url = new URL(location.href);
  if (place === null) url.searchParams.delete(PLACE_PARAM);
  else url.searchParams.set(PLACE_PARAM, place === NO_PLACE ? NO_PLACE_PARAM : place);
  history.replaceState(history.state, "", url);
}

export function initPetsFilter(apply: (filter: PetsFilter) => void): void {
  const card = $<HTMLElement>("pets-filters-card");
  const button = $<HTMLButtonElement>("pets-fab-filter");

  const filter: PetsFilter = {
    kinds: new Set(DEFAULT_PETS_FILTER.kinds),
    sexes: new Set(DEFAULT_PETS_FILTER.sexes),
    // The link decides what the page opens on, and it is read before the pets
    // land: what it names may not be an option yet.
    place: placeFromUrl(),
  };

  /** That it shows as hidden on purpose and not as data that failed to load. */
  function paintButton(): void {
    const filtering = !isDefaultPetsFilter(filter);
    for (const cls of BUTTON_OFF.split(" ")) {
      button.classList.toggle(cls, !filtering);
    }
    for (const cls of BUTTON_ON.split(" ")) {
      button.classList.toggle(cls, filtering);
    }
  }

  function push(): void {
    apply(filter);
    paintButton();
    placeToUrl(filter.place);
  }

  const kinds = createChipGroup<PetKind>(card, {
    attribute: "pets-kind",
    chips: PET_KIND_CHIPS,
    selected: filter.kinds,
    onChange: (selected) => {
      filter.kinds = selected;
      push();
    },
  });

  const sexes = createChipGroup<PetSexFilter>(card, {
    attribute: "pets-sex",
    chips: PET_SEX_CHIPS,
    selected: filter.sexes,
    onChange: (selected) => {
      filter.sexes = selected;
      push();
    },
  });

  // The one axis that is data and not a catalog: the options are the places the
  // published rows carry, so this is the only part of the card that subscribes
  // to the store. The row stays hidden while nobody has written a place —
  // «Todos los lugares» over an empty list asks nothing and answers nothing.
  const placeRow = $<HTMLDivElement>("pets-place-row");
  const place = $<HTMLSelectElement>("pets-place");

  function paintPlaces(): void {
    const options = petPlaceOptions(getPets());
    placeRow.hidden = options.length === 0;
    // A place vanishes when its last pet is withdrawn, and then what was being
    // asked for no longer exists: the grid would be empty with no way to read
    // why. Falling back to every place is the same answer as never having
    // chosen.
    //
    // Only once the pets are in, though. A place that came in the url names
    // nothing while the list is still empty, and dropping it there would undo
    // the link before the page it points at has loaded.
    const ready = getPetsState().state === "ready";
    if (
      ready &&
      filter.place !== null &&
      !options.some((o) => o.id === filter.place)
    ) {
      filter.place = null;
      push();
    }
    place.replaceChildren(
      buildOption("", "Todos los lugares"),
      ...options.map((option) => buildOption(option.id, option.label)),
    );
    place.value = filter.place ?? "";
  }

  place.addEventListener("change", () => {
    filter.place = place.value || null;
    push();
  });

  // Repainting on every change of the store and not once at boot: a pet
  // published from the bot, or one withdrawn, adds or removes a place while
  // somebody is looking at the list.
  onPets(paintPlaces);
  // And on the state, because the load emits its rows before it declares itself
  // ready: a url naming a place that does not exist is only dropped once the
  // list is in, and that last word arrives here and not above.
  onPetsState(paintPlaces);

  $<HTMLButtonElement>("pets-filters-reset").addEventListener("click", () => {
    filter.kinds = new Set(DEFAULT_PETS_FILTER.kinds);
    filter.sexes = new Set(DEFAULT_PETS_FILTER.sexes);
    filter.place = DEFAULT_PETS_FILTER.place;
    kinds.set(filter.kinds);
    sexes.set(filter.sexes);
    place.value = "";
    push();
  });

  // On desktop the card is already on screen, inside its column. On mobile that
  // column is `display: none`, and the sheet adopts the node to show it — a
  // moved node keeps its listeners, so the chips come back as they were left.
  const column = $<HTMLElement>("pets-filters-column");
  button.addEventListener("click", () => openPetSheet(card));

  // Crossing to desktop with the card still inside the sheet would leave the
  // column empty and the chips out of reach: the only copy is this one.
  onBreakpointChange(() => {
    if (!isMobile() && card.parentElement !== column) column.append(card);
  });

  // The markup already ships the chips off, but the grid knows nothing: this is
  // what takes it the defaults before the first pet lands.
  kinds.paint();
  sexes.paint();
  paintPlaces();
  push();
}

function buildOption(value: string, label: string): HTMLOptionElement {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  return option;
}
