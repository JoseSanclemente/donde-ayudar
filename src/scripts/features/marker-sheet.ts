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

  onMarkerSelect((selection) => {
    if (!selection) {
      closeDetailPanel();
      body.replaceChildren();
      return;
    }

    body.innerHTML = selection.html;
    openDetailPanel();
  });
}
