/**
 * A row of toggle chips: on carries its own colour, off goes grey, and the state
 * is `aria-pressed`. It paints and toggles, it never builds markup — the chips
 * are written by whoever owns the page, so the map keeps the `.filter-pin`
 * figure inside its buttons and rewriting `className` leaves the children alone.
 *
 * It knows neither the stores nor the features: the chips arrive as plain ids
 * with their class, and what a toggle means is the caller's problem.
 */

/** The shape of the chip, not its colour. */
export const CHIP_BASE =
  "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium transition";

/** Unmarked: the chip goes off entirely, and so does the figure it may carry. */
export const CHIP_OFF = "border-slate-200 bg-white text-slate-500";

export type ChipOption<T extends string> = {
  id: T;
  /** The marked chip, in the colour of what it stands for. */
  chipOn: string;
};

export type ChipGroup<T extends string> = {
  selected(): Set<T>;
  set(ids: Iterable<T>): void;
  paint(): void;
};

export type ChipGroupOptions<T extends string> = {
  /**
   * The `data-` attribute that marks a chip of this group, without the prefix:
   * two groups can then share one root and still tell their buttons apart.
   */
  attribute: string;
  chips: readonly ChipOption<T>[];
  selected: Iterable<T>;
  onChange(selected: Set<T>): void;
};

export function createChipGroup<T extends string>(
  root: HTMLElement,
  { attribute, chips, selected, onChange }: ChipGroupOptions<T>,
): ChipGroup<T> {
  const on = new Set<T>(selected);
  const selector = `[data-${attribute}]`;

  function paint(): void {
    for (const chip of chips) {
      const button = root.querySelector<HTMLButtonElement>(
        `[data-${attribute}="${chip.id}"]`,
      );
      if (!button) continue;
      const marked = on.has(chip.id);
      button.setAttribute("aria-pressed", String(marked));
      button.className = `${CHIP_BASE} ${marked ? chip.chipOn : CHIP_OFF}`;
    }
  }

  root.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
      selector,
    );
    // Two groups can share a root: a chip of the other one matches nothing here.
    if (!button) return;
    const id = button.dataset[toDatasetKey(attribute)] as T | undefined;
    if (!id) return;
    if (on.has(id)) on.delete(id);
    else on.add(id);
    paint();
    onChange(new Set(on));
  });

  return {
    selected: () => new Set(on),
    set(ids) {
      on.clear();
      for (const id of ids) on.add(id);
      paint();
    },
    paint,
  };
}

/** `pets-kind` is `dataset.petsKind`: the same rule the browser applies. */
function toDatasetKey(attribute: string): string {
  return attribute.replace(/-([a-z])/g, (_, letter: string) =>
    letter.toUpperCase(),
  );
}
