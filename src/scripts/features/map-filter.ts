import type { CenterType } from "../centers";
import {
  CENTER_KINDS,
  DEFAULT_MAP_FILTER,
  isDefaultFilter,
  MARKER_KINDS,
  type MapFilter,
  type MarkerKind,
} from "../map-filter";
import {
  setAffectedVisibility,
  setCenterVisibility,
  setReportVisibility,
} from "../map";
import { createChipGroup } from "../ui/chip-group";
import { $ } from "../ui/dom";

/**
 * Las casillas de `MapFilters.astro`.
 *
 * El estado vive acá y no en un store con emisor: nadie más lo consume. `map.ts`
 * se guarda lo que se le pasa y filtra por dentro, así que la lista y la capa de
 * puntos siguen sin enterarse — el filtro del mapa esconde pines, el de la lista
 * esconde tarjetas, y son dos ejes distintos.
 */

const filter: MapFilter = {
  kinds: new Set(DEFAULT_MAP_FILTER.kinds),
  onlyActiveCenters: DEFAULT_MAP_FILTER.onlyActiveCenters,
  onlyRecentReports: DEFAULT_MAP_FILTER.onlyRecentReports,
};

// Literales, como en `resources.ts`: el escáner de Tailwind lee este archivo
// como texto plano y una clase interpolada nunca se compila.
const BUTTON_OFF = "border-slate-200 bg-white text-slate-700";
const BUTTON_ON = "border-red-300 bg-red-50 text-red-700";

let button: HTMLButtonElement | null = null;

function apply(): void {
  const types = new Set<CenterType>(
    CENTER_KINDS.filter((id) => filter.kinds.has(id)),
  );
  setCenterVisibility(types, filter.onlyActiveCenters);
  setReportVisibility(filter.kinds.has("reporte"), filter.onlyRecentReports);
  setAffectedVisibility(filter.kinds.has("afectada"));
  paintButton();
}

/** Que se note que hay pines escondidos a propósito y no que falten datos. */
function paintButton(): void {
  if (!button) return;
  const filtering = !isDefaultFilter(filter);
  for (const cls of BUTTON_OFF.split(" "))
    button.classList.toggle(cls, !filtering);
  for (const cls of BUTTON_ON.split(" "))
    button.classList.toggle(cls, filtering);
}

/** Las casillas se pintan solas al tocarlas; esto es para el arranque y el reinicio. */
function paintFlags(card: HTMLElement): void {
  for (const box of card.querySelectorAll<HTMLInputElement>(
    "[data-filter-flag]",
  )) {
    const flag = box.dataset.filterFlag as
      "onlyActiveCenters" | "onlyRecentReports";
    box.checked = filter[flag];
  }
}

export function initMapFilter(): void {
  const card = $<HTMLElement>("filters-card");
  button = document.getElementById("fab-filter") as HTMLButtonElement | null;

  // Los chips son los mismos de `/mascotas`: el color lo pone el tipo y el
  // apagado lo pone el helper, que es el único que sabe cómo se ve un chip.
  const kinds = createChipGroup<MarkerKind>(card, {
    attribute: "filter-kind",
    chips: MARKER_KINDS,
    selected: filter.kinds,
    onChange: (selected) => {
      filter.kinds = selected;
      apply();
    },
  });

  card.addEventListener("change", (event) => {
    const box = event.target as HTMLInputElement;
    const flag = box.dataset.filterFlag as
      "onlyActiveCenters" | "onlyRecentReports" | undefined;
    if (!flag) return;
    filter[flag] = box.checked;
    apply();
  });

  document.getElementById("filters-reset")?.addEventListener("click", () => {
    filter.kinds = new Set(DEFAULT_MAP_FILTER.kinds);
    filter.onlyActiveCenters = DEFAULT_MAP_FILTER.onlyActiveCenters;
    filter.onlyRecentReports = DEFAULT_MAP_FILTER.onlyRecentReports;
    kinds.set(filter.kinds);
    paintFlags(card);
    apply();
  });

  // El marcado ya viene con los chips puestos, pero el mapa no sabe nada: esto
  // es lo que le lleva los valores por defecto antes de que llegue el primer
  // dato.
  kinds.paint();
  paintFlags(card);
  apply();
}
