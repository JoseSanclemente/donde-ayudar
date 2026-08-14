import { getUpdates, onUpdates } from "../data/updates";
import { openUpdatesPanel } from "../sheet";
import { $, scheduleRender } from "../ui/dom";
import { isFresh, paintTime } from "../ui/time";

/**
 * The newest novedad, one line, at the top of the header.
 *
 * The city log is what moves fastest, and on mobile it lives inside a closed
 * sheet: nobody reads it without going looking for it. This is the headline —
 * the last thing somebody wrote, and a door into the panel where the rest is.
 */
export function initAlertBanner(): void {
  const banner = $<HTMLButtonElement>("alert-banner");
  const body = $<HTMLSpanElement>("alert-banner-body");
  const time = $<HTMLSpanElement>("alert-banner-time");

  banner.addEventListener("click", () => openUpdatesPanel());
  banner.addEventListener("animationend", () => {
    delete banner.dataset.shake;
  });

  let shaken = false;

  function render() {
    // `data/updates` keeps the cache sorted newest first.
    const latest = getUpdates()[0];

    banner.classList.toggle("hidden", !latest);
    if (!latest) return;

    body.textContent = latest.body;
    paintTime(time, latest.createdAt);

    if (!shaken && isFresh(latest.createdAt)) {
      shaken = true;
      banner.dataset.shake = "";
    }
  }

  onUpdates(scheduleRender(render));
  render();
}
