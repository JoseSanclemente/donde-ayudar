import { confirmCenter, removeCenter } from "../data/centers";
import { setReportStatus, setResourceCovered } from "../data/reports";
import { isStatus } from "../status";
import { confirmClose } from "../ui/status-select";

/**
 * What can be done from a marker's detail — popup on desktop, bottom sheet on
 * mobile: change a report's status, mark one of its resources as covered, and
 * delete or confirm one's own center. The
 * HTML is built by `map.ts`, which cannot touch the stores, so the wiring lives
 * here.
 *
 * Listeners are delegated on `document` and not one per control: both
 * containers are rebuilt whole on every store emission, so any listener stuck
 * to the node would have to be stuck again on every tick.
 */
export function initMarkerActions(): void {
  document.addEventListener("change", (event) => {
    const select = (
      event.target as HTMLElement | null
    )?.closest<HTMLSelectElement>("[data-status-select]");
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
    const chip = (
      event.target as HTMLElement | null
    )?.closest<HTMLButtonElement>("[data-cover-resource]");
    if (!chip) return;

    const resource = chip.dataset.coverResource;
    if (!resource) return;

    const ids = (chip.dataset.reportIds ?? "").split(",").filter(Boolean);
    if (ids.length === 0) return;

    setResourceCovered(ids, resource, chip.dataset.covered !== "true");
  });

  document.addEventListener("click", (event) => {
    const button = (
      event.target as HTMLElement | null
    )?.closest<HTMLButtonElement>("[data-delete-center]");
    if (!button) return;

    const id = button.dataset.deleteCenter;
    if (!id) return;

    const name = button.dataset.pointName ?? "este punto";
    if (!confirm(`¿Eliminar «${name}» del mapa? Deja de verlo todo el mundo.`))
      return;

    removeCenter(id);
  });

  document.addEventListener("click", (event) => {
    const button = (
      event.target as HTMLElement | null
    )?.closest<HTMLButtonElement>("[data-confirm-center]");
    if (!button) return;

    const id = button.dataset.confirmCenter;
    if (!id) return;

    confirmCenter(id);
  });
}
