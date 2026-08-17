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
import { caretHtml, SELECT_CHIP } from "./select";

export function statusSelectHtml(
  status: string,
  reportIds: string[],
  name: string,
): string {
  const options = STATUSES.map(
    (item) =>
      `<option value="${item.id}"${item.id === status ? " selected" : ""}>${escapeHtml(item.label)}</option>`,
  ).join("");

  return `<span
      class="inline-flex items-center gap-1 rounded-full border px-3 py-2 text-sm font-semibold ${statusInfo(status).chip}"
      title="Cómo está el punto ahora mismo"
    ><select
        data-status-select
        data-current="${escapeHtml(status)}"
        data-report-ids="${escapeHtml(reportIds.join(","))}"
        data-point-name="${escapeHtml(name)}"
        class="${SELECT_CHIP}"
        aria-label="Estado de ${escapeHtml(name)}"
        title="Cómo está el punto ahora mismo"
      >${options}</select
      >${caretHtml("chip")}</span>`;
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
