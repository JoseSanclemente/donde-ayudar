import { locateUser, writeCachedCoords, type Coords } from "../geolocation";
import { flyToUser, mountControl, setInitialView, setUserMarker } from "../map";
import { $ } from "../ui/dom";
import { showToast } from "../ui/toast";

/**
 * Dónde está quien mira el mapa: la vista inicial, el punto azul y el botón
 * para volver a él.
 *
 * El permiso se pide al cargar y la respuesta puede tardar o no llegar nunca:
 * mientras tanto el mapa ya está pintado y ahí se queda si toca. En el arranque
 * no se avisa nada — nadie preguntó, y que el mapa abra en un sitio u otro no es
 * un error que la persona tenga que atender. Al tocar el botón sí: eso es una
 * pregunta explícita y tiene que contestar algo.
 *
 * El punto solo se dibuja con una respuesta viva del navegador, nunca con la
 * coordenada guardada: centrar el mapa en una posición de hace semanas no le
 * hace daño a nadie, pero un punto que dice «estás acá» sí estaría mintiendo.
 */
let coords: Coords | null = null;
let inFlight = false;

/**
 * La posición viva, o `null` si el permiso no ha contestado. No cae a la caché
 * a propósito: quien la quiera vieja que la pida a `readCachedCoords()` y sepa
 * lo que está leyendo.
 */
export function getUserCoords(): Coords | null {
  return coords;
}

function remember(next: Coords): void {
  coords = next;
  writeCachedCoords(next);
  setUserMarker(next.lat, next.lng);
}

/** Segundo intento, ya con alguien esperando la respuesta. */
function locateAndFly(): void {
  if (inFlight) return;
  inFlight = true;
  void locateUser().then((next) => {
    inFlight = false;
    if (!next) {
      showToast(
        "No pudimos obtener tu ubicación. Revisa los permisos del navegador.",
      );
      return;
    }
    remember(next);
    flyToUser();
  });
}

export function initUserLocation(): void {
  void locateUser().then((next) => {
    if (!next) return;
    remember(next);
    setInitialView(next.lat, next.lng);
  });

  const button = $("locate-me");
  // Debajo del zoom, en la misma esquina y con la misma alineación: los tres
  // botones son un solo grupo.
  mountControl(button);

  button.addEventListener("click", () => {
    // Sin posición todavía: el permiso pudo negarse, vencerse o seguir abierto.
    // Un navegador que ya lo tiene contesta de una; uno que lo negó, también.
    if (coords) flyToUser();
    else locateAndFly();
  });
}
