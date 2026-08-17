/**
 * The trades someone can sign up with: what each one is called, what colour it
 * wears, and what the notes field asks for once it is picked.
 *
 * The specialty is a column and not a panel. It used to be one panel per `kind`,
 * with its own tab and its own copy, and that is what filed the signups wrong:
 * adding a trade meant adding a tab, so a trade nobody had added went into
 * whichever tab was nearest. Now there is one panel, one tab, and adding a trade
 * is an entry here plus its value in the CHECK.
 *
 * `otra` is not a leftover, it is the escape valve: without a value for «none of
 * these», the next unlisted trade repeats the same failure.
 *
 * No Supabase and no DOM: the markup reads this to build the select and the
 * filter chips, and the feature reads it to paint a card. The classes are
 * literal, same rule as `resources.ts` — the Tailwind scanner reads this file as
 * plain text and an interpolated class never gets compiled.
 */
import type { ChipOption } from "./ui/chip-group";

export type VolunteerKind =
  | "salud_mental"
  | "juridica"
  | "construccion"
  | "funeraria"
  | "otra";

export type VolunteerLabel = {
  label: string;

  chip: string;

  notesPlaceholder: string;
};

export const VOLUNTEER_KINDS: Record<VolunteerKind, VolunteerLabel> = {
  salud_mental: {
    label: "Salud mental",
    chip: "border-emerald-800 bg-emerald-100 text-emerald-800",
    notesPlaceholder:
      "Cómo puedes apoyar y en qué horarios. Ej: psicóloga, tardes entre semana.",
  },
  juridica: {
    label: "Jurídica",
    chip: "border-sky-800 bg-sky-100 text-sky-800",
    notesPlaceholder:
      "En qué puedes asesorar y en qué horarios. Ej: abogada laboralista, tardes.",
  },
  construccion: {
    label: "Construcción",
    chip: "border-amber-800 bg-amber-100 text-amber-800",
    notesPlaceholder:
      "Qué puedes revisar y en qué horarios. Ej: ingeniero civil, si el muro aguanta.",
  },
  funeraria: {
    label: "Funeraria",
    chip: "border-purple-800 bg-purple-100 text-purple-800",
    notesPlaceholder:
      "En qué puedes acompañar. Ej: trámites de defunción y exequias.",
  },
  otra: {
    label: "Otra",
    chip: "border-slate-700 bg-slate-100 text-slate-700",
    notesPlaceholder: "En qué puedes ayudar y en qué horarios.",
  },
};

export const DEFAULT_VOLUNTEER_KIND: VolunteerKind = "salud_mental";

export const VOLUNTEER_KIND_IDS = Object.keys(
  VOLUNTEER_KINDS,
) as VolunteerKind[];

export function volunteerLabel(kind: VolunteerKind): VolunteerLabel {
  return VOLUNTEER_KINDS[kind] ?? VOLUNTEER_KINDS.otra;
}

export const VOLUNTEER_KIND_CHIPS: (ChipOption<VolunteerKind> &
  VolunteerLabel)[] = VOLUNTEER_KIND_IDS.map((id) => ({
  id,
  ...VOLUNTEER_KINDS[id],
  chipOn: VOLUNTEER_KINDS[id].chip,
}));

/**
 * The tab icon: a raised hand, one `<path>` and nothing else. The selected tab is
 * painted by filling everything that is not a `circle` (`global.css`), so a
 * second path would disappear into the silhouette — several subpaths inside the
 * same `d` are fine.
 *
 * It is generic on purpose. The old head-with-heart named one trade, and the tab
 * now fronts all of them; the heart already belongs to «Donaciones».
 */
export const VOLUNTEER_ICON = {
  path: "M9.1 10.4V4.6a1.05 1.05 0 012.1 0v5.2h.9V5.6a1.05 1.05 0 012.1 0v4.2h.9V7.2a1.05 1.05 0 012.1 0v5.5c0 2.7-2 4.8-4.7 4.8-1.5 0-2.8-.6-3.7-1.7L5.2 12a1.05 1.05 0 011.5-1.4l2.4 2.3z",
};

/**
 * An empty row asks for nothing, the same way `/mascotas` reads and the opposite
 * of the map filter: tapping «Jurídica» leaves the lawyers instead of hiding
 * them. Within the row the marked chips add up.
 */
export function matchesVolunteerFilter(
  kind: VolunteerKind,
  selected: Set<VolunteerKind>,
): boolean {
  return selected.size === 0 || selected.has(kind);
}
