import { loadAffectedZones } from "../affected-zones";
import { setAffectedZones } from "../map";

/**
 * Las zonas afectadas en el mapa.
 *
 * La más corta de las features: no hay store, ni realtime, ni repintado por
 * reloj como en `centers-layer.ts` —una zona no vence a las 24 horas—. Es un
 * archivo estático que se pide una vez y se dibuja una vez.
 *
 * Si el archivo no está no pasa nada: el mapa se queda sin la capa y el resto
 * del sitio funciona igual, que es justo lo contrario de dejar el arranque
 * colgado de un JSON curado.
 */
export function initAffectedLayer(): void {
  void loadAffectedZones()
    .then(setAffectedZones)
    .catch((error) => console.warn("Zonas afectadas no disponibles:", error));
}
