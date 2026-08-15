import { flyToValle, mountControl } from "../map";
import { $ } from "../ui/dom";

/**
 * «Ver todo el Valle»: el botón que se aleja hasta que cabe la emergencia
 * entera.
 *
 * El mapa abre encima de quien lo mira y ahí se queda, así que un municipio del
 * norte a doscientos kilómetros no existe hasta que alguien arrastra. Este es el
 * camino de vuelta al otro lado de la pregunta: no dónde estoy yo, sino dónde
 * está todo.
 *
 * Va en la misma esquina que «Centrar en mí» y debajo, que es lo que decide el
 * orden en que se montan: `mountControl` va agregando al final. Alejarse es la
 * respuesta más rara de las dos —la mayoría entra a mirar su barrio—, así que
 * queda de última.
 */
export function initValleView(): void {
  const button = $("see-valle");
  mountControl(button);
  button.addEventListener("click", () => flyToValle());
}
