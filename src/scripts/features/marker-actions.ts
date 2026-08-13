import { confirmCenter, removeCenter } from "../data/centers";
import { setReportStatus } from "../data/reports";
import { isStatus } from "../status";
import { confirmClose } from "../ui/status-select";

/**
 * What can be done from a marker's detail — popup on desktop, bottom sheet on
 * mobile: change a report's status, and delete or confirm one's own center. The
 * HTML is built by `map.ts`, which cannot touch the stores, so the wiring lives
 * here.
 *
 * Listeners are delegated on `document` and not one per control: both
 * containers are rebuilt whole on every store emission, so any listener stuck
 * to the node would have to be stuck again on every tick.
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
      "[data-delete-center]",
    );
    if (!button) return;

    const id = button.dataset.deleteCenter;
    if (!id) return;

    // A point cannot be edited after publishing, so deleting it is the only
    // correction there is and it does not come back. Same native `confirm` as
    // closing a point — the other action that changes the map for everybody.
    const name = button.dataset.pointName ?? "este punto";
    if (!confirm(`¿Eliminar «${name}» del mapa? Deja de verlo todo el mundo.`)) return;

    // The open detail closes on its own: repainting the layer without this
    // point makes `setCenters` drop the selected marker, and `marker-sheet`
    // answers.
    removeCenter(id);
  });

  document.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>(
      "[data-confirm-center]",
    );
    if (!button) return;

    const id = button.dataset.confirmCenter;
    if (!id) return;

    // No `confirm()`, the other way round from deleting: this takes nothing
    // away from anybody and time undoes it on its own. Asking twice for
    // something that expires in a day is what stops people from touching it.
    confirmCenter(id);
  });
}
