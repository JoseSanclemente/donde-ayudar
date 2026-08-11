import { onMarkerSelect } from "../map";
import { closeDetailPanel, openDetailPanel } from "../sheet";
import { $ } from "../ui/dom";

/**
 * El detalle de un punto en móvil. La burbuja de Leaflet queda debajo del header
 * y de los botones flotantes en una pantalla de teléfono, así que tocar un
 * marcador sube el bottom sheet con el mismo contenido del popup — el mapa lo
 * manda ya armado, acá solo se le busca envase.
 */
export function initMarkerSheet(): void {
  const body = $<HTMLDivElement>("detail-body");
  const back = $<HTMLButtonElement>("detail-back");

  back.addEventListener("click", closeDetailPanel);

  onMarkerSelect((selection) => {
    if (!selection) {
      // El punto dejó de existir (lo borraron, o un filtro lo escondió).
      closeDetailPanel();
      body.replaceChildren();
      return;
    }
    // El HTML lo arma `map.ts` con `escapeHtml`, igual que para el popup.
    body.innerHTML = selection.html;
    openDetailPanel();
  });
}
