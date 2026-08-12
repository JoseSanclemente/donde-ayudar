/**
 * El selector de estado como string, para los sitios que se arman como HTML —el
 * popup del mapa y, con el mismo HTML, el sheet de móvil—. La lista construye su
 * propio `<select>` como elemento, pero el aviso de cierre se comparte desde acá:
 * es la misma advertencia y no debería decirse de dos maneras.
 *
 * No sabe de stores: quien escucha el `change` es una feature.
 */
import { statusInfo, STATUSES } from "../status";
import { escapeHtml } from "./html";

export function statusSelectHtml(
  status: string,
  reportIds: string[],
  name: string,
): string {
  const options = STATUSES.map(
    (item) =>
      `<option value="${item.id}"${item.id === status ? " selected" : ""}>${escapeHtml(item.label)}</option>`,
  ).join("");

  // El chip es el envase y no el `<select>`: la flecha nativa la pinta el
  // navegador contra el borde del elemento, fuera del flujo, así que el `px-2`
  // del chip no la corría y quedaba montada sobre la esquina redonda. Se apaga
  // con `appearance-none` y se dibuja como un glifo más, que sí respeta el
  // padding y hereda el color del estado.
  //
  // `data-current` guarda el estado de partida: si alguien cancela el aviso de
  // cierre hay que devolver el `<select>` a donde estaba, y el DOM ya perdió el
  // valor anterior para cuando llega el `change`.
  return `<span
      class="inline-flex justify-between items-center gap-1 rounded-full px-2 py-2 text-sm font-semibold focus-within:ring-2 focus-within:ring-slate-400 ${statusInfo(status).chip}"
      title="Cómo está el punto ahora mismo"
    ><select
        data-status-select
        data-current="${escapeHtml(status)}"
        data-report-ids="${escapeHtml(reportIds.join(","))}"
        data-point-name="${escapeHtml(name)}"
        class="appearance-none border-0 bg-transparent p-0 font-semibold text-inherit outline-none"
        aria-label="Estado de ${escapeHtml(name)}"
        title="Cómo está el punto ahora mismo"
      >${options}</select
      ><span aria-hidden="true" class="pointer-events-none text-[0.65rem] opacity-70">▾</span
    ></span>`;
}

/**
 * Cerrar un punto le corta la ayuda a todo el mundo, y cualquiera puede hacerlo:
 * al menos que no sea por un toque accidental.
 */
export function confirmClose(name: string): boolean {
  return confirm(
    `¿Marcar «${name}» como cerrado? Le va a aparecer a todo el mundo como «no te desplaces».`,
  );
}
