import { loadCentros } from "../centros";
import { setCentros } from "../map";

/**
 * Lista curada: llega serializada en el HTML desde la content collection, así
 * que acá solo se dibuja. No hay manera de agregar uno desde la UI, ni de
 * filtrarlos: los puntos donados son una capa fija del mapa.
 */
export function initCentrosLayer(): void {
  setCentros(loadCentros());
}
