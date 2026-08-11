import { loadCentros } from "../centros";
import { setCentroFilter, setCentros, setCentrosVisible } from "../map";
import { CHIP_OFF, chipOnClass } from "../resources";
import { $, maybe$ } from "../ui/dom";

/**
 * Lista curada: llega serializada en el HTML desde la content collection, así
 * que acá solo se dibuja y se filtra. No hay manera de agregar uno desde la UI.
 */
export function initCentrosPanel(): void {
  // La tarjeta no se renderiza si no hay ningún centro activo.
  if (!maybe$("centros-card")) return;

  const toggle = $<HTMLInputElement>("centros-toggle");
  const filterRow = $<HTMLDivElement>("centros-filter");
  const emptyNote = $<HTMLParagraphElement>("centros-empty");
  const chips = [...filterRow.querySelectorAll<HTMLButtonElement>("[data-centro-filter]")];
  let active = "";

  // El aviso solo tiene sentido si la capa está encendida: con el toggle en off
  // no hay centros visibles por decisión de la persona, no por el filtro.
  const reportShown = (shown: number) => {
    emptyNote.classList.toggle("hidden", shown > 0 || !toggle.checked);
  };

  const paintChips = () => {
    for (const chip of chips) {
      const on = (chip.dataset.centroFilter ?? "") === active;
      chip.setAttribute("aria-pressed", String(on));
      chip.className = on ? chipOnClass(chip.dataset.centroFilter || undefined) : CHIP_OFF;
    }
  };

  reportShown(setCentros(loadCentros()));

  filterRow.addEventListener("click", (event) => {
    const chip = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-centro-filter]");
    if (!chip) return;
    active = chip.dataset.centroFilter ?? "";
    paintChips();
    reportShown(setCentroFilter(active || null));
  });

  toggle.addEventListener("change", () => {
    reportShown(setCentrosVisible(toggle.checked));
  });
}
