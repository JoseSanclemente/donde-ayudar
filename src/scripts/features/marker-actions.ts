import { confirmCentro, removeCentro } from "../data/centros";
import { setReportStatus } from "../data/reports";
import { isStatus } from "../status";
import { confirmClose } from "../ui/status-select";

/**
 * Lo que se puede hacer desde el detalle de un marcador —popup en escritorio,
 * bottom sheet en móvil—: cambiarle el estado a un reporte y borrar un punto de
 * acopio propio. El HTML lo arma `map.ts` —que no puede tocar los stores—, así
 * que el cableado vive acá.
 *
 * Listeners delegados en `document` y no uno por control: los dos contenedores
 * se rehacen enteros en cada emisión del store, así que cualquier listener
 * pegado al nodo habría que volver a pegarlo en cada tick. Delegar en
 * `document` es además lo que hace que el mismo HTML sirva en los dos sitios
 * sin que este archivo sepa de ninguno.
 */
export function initMarkerActions(): void {
  document.addEventListener("change", (event) => {
    const select = (event.target as HTMLElement | null)?.closest<HTMLSelectElement>(
      "[data-status-select]",
    );
    if (!select) return;

    const next = select.value;
    if (!isStatus(next)) return;

    const name = select.dataset.pointName ?? "este punto";
    if (next === "cerrado" && !confirmClose(name)) {
      select.value = select.dataset.current ?? next;
      return;
    }

    const ids = (select.dataset.reportIds ?? "").split(",").filter(Boolean);
    if (ids.length === 0) return;
    setReportStatus(ids, next);
  });

  document.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>(
      "[data-delete-centro]",
    );
    if (!button) return;

    const id = button.dataset.deleteCentro;
    if (!id) return;

    // Un punto no se puede editar después de publicarlo, así que borrarlo es la
    // única corrección posible y no tiene vuelta atrás: nadie en la aplicación
    // deshace nada. Mismo `confirm` nativo que al cerrar un punto — la otra
    // acción que le cambia el mapa a todo el mundo.
    const name = button.dataset.pointName ?? "este punto";
    if (!confirm(`¿Eliminar «${name}» del mapa? Deja de verlo todo el mundo.`)) return;

    // El detalle abierto se cierra solo: al repintar la capa sin este punto,
    // `setCentros` suelta el marcador seleccionado y `marker-sheet` responde.
    removeCentro(id);
  });

  document.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>(
      "[data-confirm-centro]",
    );
    if (!button) return;

    const id = button.dataset.confirmCentro;
    if (!id) return;

    // Sin `confirm()`, al revés que borrar: esto no le quita nada a nadie y el
    // tiempo lo deshace solo. Preguntar dos veces por algo que caduca en doce
    // horas es lo que hace que la gente no lo toque.
    confirmCentro(id);
  });
}
