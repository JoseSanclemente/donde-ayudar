import { $ } from "../ui/dom";

/**
 * Publica la altura real del header en `--header-h`.
 *
 * En móvil el header flota sobre el mapa, que ocupa la pantalla entera: nadie
 * reserva ese espacio, así que los controles de Leaflet se bajan a mano desde
 * el CSS. Un valor fijo se quedaba corto en cuanto el header crecía —el área
 * segura del notch, el aviso de puntos saturados o el título partido en dos
 * líneas—, y los botones de zoom terminaban debajo de la franja blanca.
 */
export function initHeaderOffset(): void {
  const header = $<HTMLElement>("site-header");

  const publish = () => {
    // `offsetHeight` y no `getBoundingClientRect()`: la entrada con GSAP deja un
    // `translateY` sobre el header, y el rect lo incluye. La altura de layout no.
    document.documentElement.style.setProperty(
      "--header-h",
      `${header.offsetHeight}px`,
    );
  };

  new ResizeObserver(publish).observe(header);
  publish();
}
