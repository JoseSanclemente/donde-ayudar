import {
  DEFAULT_PETS_FILTER,
  isDefaultPetsFilter,
  PET_KIND_CHIPS,
  PET_SEX_CHIPS,
  type PetsFilter,
  type PetSexFilter,
} from "../pets-filter";
import type { PetKind } from "../data/pets";
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
const BUTTON_OFF = "border-slate-200 bg-white text-slate-700";
const BUTTON_ON = "border-red-300 bg-red-50 text-red-700";

export function initPetsFilter(apply: (filter: PetsFilter) => void): void {
  const card = $<HTMLElement>("pets-filters-card");
  const button = $<HTMLButtonElement>("pets-fab-filter");

  const filter: PetsFilter = {
    kinds: new Set(DEFAULT_PETS_FILTER.kinds),
    sexes: new Set(DEFAULT_PETS_FILTER.sexes),
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

  $<HTMLButtonElement>("pets-filters-reset").addEventListener("click", () => {
    filter.kinds = new Set(DEFAULT_PETS_FILTER.kinds);
    filter.sexes = new Set(DEFAULT_PETS_FILTER.sexes);
    kinds.set(filter.kinds);
    sexes.set(filter.sexes);
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
  push();
}
