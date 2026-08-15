import { flyToEmergency, mountControl } from "../map";
import { $ } from "../ui/dom";

/**
 * «Ver toda la emergencia»: el botón que se aleja hasta que cabe entera.
 *
 * El mapa abre encima de quien lo mira y ahí se queda, así que un municipio del
 * norte del Valle o del Chocó no existe hasta que alguien arrastre. Este es el
 * camino de vuelta al otro lado de la pregunta: no dónde estoy yo, sino dónde
 * está todo.
 *
 * Se llamaba «ver todo el Valle» hasta que entraron los municipios del Chocó, y
 * el nombre dejó de ser cierto: el epicentro quedó en San José del Palmar y 29
 * de los 31 municipios de ese departamento resultaron golpeados. Encuadrar lo
 * que hay dibujado ya lo contestaba solo; lo único que había que arreglar era
 * cómo se llama.
 *
 * Va en la misma esquina que «Centrar en mí» y debajo, que es lo que decide el
 * orden en que se montan: `mountControl` va agregando al final. Alejarse es la
 * respuesta más rara de las dos —la mayoría entra a mirar su barrio—, así que
 * queda de última.
 */
/**
 * `stats` es la tarjeta de cifras, y el orden de sus dos verbos es todo lo que
 * hace esta feature:
 *
 * 1. `reservedTop()` — cuánto va a tapar la tarjeta, medido **sin mostrarla**.
 *    Se lo lleva el vuelo como relleno asimétrico: sin eso, un encuadre centrado
 *    mete la mitad norte de los pines justo debajo de la tarjeta que este mismo
 *    toque va a abrir.
 * 2. `show()` — al aterrizar. La tarjeta baja del header y los números suben al
 *    tiempo. Las dos cosas juntas y al final: son la respuesta a haberse
 *    alejado, y adelantarlas deja la tarjeta esperando en cero a que el mapa
 *    termine de moverse.
 *
 * Entra por parámetro y con un tipo estructural, sin importar la otra feature:
 * `app.ts` las une, igual que `pets.ts` le pasa el `setFilter` de la grilla al
 * filtro.
 */
type StatsCard = {
  reservedTop: () => number;
  show: () => void;
};

export function initEmergencyView(stats?: StatsCard): void {
  const button = $("see-emergency");
  mountControl(button);
  button.addEventListener("click", () => {
    void flyToEmergency(stats?.reservedTop() ?? 0).then(() => stats?.show());
  });
}
