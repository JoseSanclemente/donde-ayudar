import type { CenterType } from "../centers";
import {
  CENTER_KINDS,
  DEFAULT_MAP_FILTER,
  isDefaultFilter,
  KIND_CHIP_BASE,
  KIND_CHIP_OFF,
  MARKER_KINDS,
  type MapFilter,
  type MarkerKind,
} from "../map-filter";
import { setCenterVisibility, setReportVisibility } from "../map";
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
  paintButton();
}

/** Que se note que hay pines escondidos a propósito y no que falten datos. */
function paintButton(): void {
  if (!button) return;
  const filtering = !isDefaultFilter(filter);
  for (const cls of BUTTON_OFF.split(" ")) button.classList.toggle(cls, !filtering);
  for (const cls of BUTTON_ON.split(" ")) button.classList.toggle(cls, filtering);
}

/** El color del chip lo pone el tipo, así que cada uno se apaga con el suyo. */
function paintPanel(card: HTMLElement): void {
  for (const kind of MARKER_KINDS) {
    const chip = card.querySelector<HTMLButtonElement>(
      `[data-filter-kind="${kind.id}"]`,
    );
    if (!chip) continue;
    const on = filter.kinds.has(kind.id);
    chip.setAttribute("aria-pressed", String(on));
    chip.className = `${KIND_CHIP_BASE} ${on ? kind.chipOn : KIND_CHIP_OFF}`;
  }
  for (const box of card.querySelectorAll<HTMLInputElement>("[data-filter-flag]")) {
    const flag = box.dataset.filterFlag as "onlyActiveCenters" | "onlyRecentReports";
    box.checked = filter[flag];
  }
}

export function initMapFilter(): void {
  const card = $<HTMLElement>("filters-card");
  button = document.getElementById("fab-filter") as HTMLButtonElement | null;

  card.addEventListener("click", (event) => {
    const chip = (event.target as HTMLElement).closest<HTMLButtonElement>(
      "[data-filter-kind]",
    );
    if (!chip) return;
    const kind = chip.dataset.filterKind as MarkerKind;
    if (filter.kinds.has(kind)) filter.kinds.delete(kind);
    else filter.kinds.add(kind);
    paintPanel(card);
    apply();
  });

  card.addEventListener("change", (event) => {
    const box = event.target as HTMLInputElement;
    const flag = box.dataset.filterFlag as
      | "onlyActiveCenters"
      | "onlyRecentReports"
      | undefined;
    if (!flag) return;
    filter[flag] = box.checked;
    apply();
  });

  document.getElementById("filters-reset")?.addEventListener("click", () => {
    filter.kinds = new Set(DEFAULT_MAP_FILTER.kinds);
    filter.onlyActiveCenters = DEFAULT_MAP_FILTER.onlyActiveCenters;
    filter.onlyRecentReports = DEFAULT_MAP_FILTER.onlyRecentReports;
    paintPanel(card);
    apply();
  });

  // El marcado ya viene con los chips puestos, pero el mapa no sabe nada: esto
  // es lo que le lleva los valores por defecto antes de que llegue el primer
  // dato.
  paintPanel(card);
  apply();
}
