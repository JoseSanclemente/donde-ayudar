/**
 * What a pet is called and what colour it wears, plus what the filter of
 * `/mascotas` can hide.
 *
 * It lives here and not in the feature for the same reason as `map-filter.ts`:
 * the component that draws the chips reads it to build itself, the grid reads it
 * to paint a card, and the feature reads it to know what exists. No Supabase, no
 * DOM.
 *
 * The classes are literal, like in `resources.ts` and `status.ts`: the Tailwind
 * scanner reads this file as plain text and an interpolated class never gets
 * compiled.
 */
import type { Pet, PetKind, PetSex } from "./data/pets";
import type { ChipOption } from "./ui/chip-group";

export type PetLabel = { label: string; chip: string };

export const PET_KINDS: Record<PetKind, PetLabel> = {
  dog: { label: "Perro", chip: "border-amber-800 bg-amber-100 text-amber-800" },
  cat: {
    label: "Gato",
    chip: "border-violet-800 bg-violet-100 text-violet-800",
  },
  other: {
    label: "Otro",
    chip: "border-slate-700 bg-slate-100 text-slate-700",
  },
};

export const PET_SEXES: Record<PetSex, PetLabel> = {
  male: { label: "Macho", chip: "border-sky-800 bg-sky-100 text-sky-800" },
  female: {
    label: "Hembra",
    chip: "border-pink-800 bg-pink-100 text-pink-800",
  },
};

/**
 * A pet with no sex is not a gap in the filter: it is «no sé» from whoever found
 * it, and every row published before the column existed. Without a value to name
 * it, turning on «Macho» would bury them where nobody can reach them again.
 */
export type PetSexFilter = PetSex | "unknown";

export const UNKNOWN_SEX: PetLabel = {
  label: "Sin dato",
  chip: "border-slate-700 bg-slate-100 text-slate-700",
};

export function petSexLabel(sex: PetSexFilter): PetLabel {
  return sex === "unknown" ? UNKNOWN_SEX : PET_SEXES[sex];
}

/** The filter chip is the legend of the card chip: the same colour, both rows. */
export const PET_KIND_CHIPS: (ChipOption<PetKind> & PetLabel)[] = (
  Object.keys(PET_KINDS) as PetKind[]
).map((id) => ({ id, ...PET_KINDS[id], chipOn: PET_KINDS[id].chip }));

export const PET_SEX_CHIPS: (ChipOption<PetSexFilter> & PetLabel)[] = (
  ["male", "female", "unknown"] as PetSexFilter[]
).map((id) => ({ id, ...petSexLabel(id), chipOn: petSexLabel(id).chip }));

/**
 * An empty row asks for nothing, and that is what makes the chips read the way
 * anyone expects: tapping «Perro» leaves the dogs, not everything except them.
 * The map filter reads the other way around — its chips are the legend of the
 * pins and start marked, so unticking one hides a kind — but there the row
 * doubles as a key to what is drawn, and here it is a question about a list.
 *
 * Within a row the marked chips add up; between rows they narrow.
 */
export type PetsFilter = {
  kinds: Set<PetKind>;
  sexes: Set<PetSexFilter>;
};

/** The grid opens on everything, with nothing asked for. */
export const DEFAULT_PETS_FILTER: PetsFilter = {
  kinds: new Set(),
  sexes: new Set(),
};

/** If nothing is being asked for: the button says so. */
export function isDefaultPetsFilter(filter: PetsFilter): boolean {
  return filter.kinds.size === 0 && filter.sexes.size === 0;
}

export function matchesPetsFilter(pet: Pet, filter: PetsFilter): boolean {
  return (
    (filter.kinds.size === 0 || filter.kinds.has(pet.kind)) &&
    (filter.sexes.size === 0 || filter.sexes.has(pet.sex ?? "unknown"))
  );
}
