import { groupReports } from "../cluster";
import { getReports, onChange } from "../data/reports";
import { onUpdates } from "../data/updates";
import { flyTo } from "../map";
import { collapseSheet } from "../sheet";
import { isBlocked, statusInfo } from "../status";
import { $, scheduleRender } from "../ui/dom";
import { relativeTime } from "../ui/time";

/**
 * «No te desplaces»: los puntos que alguien reportó como llenos o cerrados.
 *
 * Es lo único de la página que se lee antes de salir de la casa, así que va
 * arriba del todo y colapsado a una línea: el detalle se despliega, el aviso no
 * se pierde.
 */
export function initAlertBanner(): void {
  const banner = $<HTMLDivElement>("alert-banner");
  const toggle = $<HTMLButtonElement>("alert-banner-toggle");
  const summary = $<HTMLSpanElement>("alert-banner-summary");
  const caret = $<HTMLSpanElement>("alert-banner-caret");
  const body = $<HTMLDivElement>("alert-banner-body");
  const list = $<HTMLUListElement>("alert-banner-list");

  let open = false;

  const paintOpen = () => {
    body.classList.toggle("hidden", !open);
    toggle.setAttribute("aria-expanded", String(open));
    caret.textContent = open ? "▴" : "▾";
  };

  toggle.addEventListener("click", () => {
    open = !open;
    paintOpen();
  });

  function render() {
    const blocked = groupReports(getReports()).filter((group) => isBlocked(group.status));

    banner.classList.toggle("hidden", blocked.length === 0);
    if (blocked.length === 0) {
      // Si se destraba el último punto, el detalle no debe quedar abierto para
      // la próxima vez que aparezca uno.
      open = false;
      paintOpen();
      return;
    }

    summary.textContent =
      blocked.length === 1
        ? "1 punto lleno o cerrado — no te desplaces sin confirmar"
        : `${blocked.length} puntos llenos o cerrados — no te desplaces sin confirmar`;

    list.replaceChildren(
      ...blocked.map((group) => {
        const item = document.createElement("li");

        const button = document.createElement("button");
        button.type = "button";
        button.className = "w-full text-left text-xs leading-snug hover:underline";
        button.addEventListener("click", () => {
          collapseSheet();
          void flyTo(group.lat, group.lng);
        });

        const name = document.createElement("span");
        name.className = "font-semibold";
        name.textContent = group.lead.name;

        const detail = document.createElement("span");
        detail.className = "text-amber-800";
        detail.textContent = ` — ${statusInfo(group.status).aviso} · ${relativeTime(group.latestAt)}`;

        button.append(name, detail);
        item.append(button);
        return item;
      }),
    );
  }

  const scheduled = scheduleRender(render);
  onChange(scheduled);
  onUpdates(scheduled);
  render();
}
