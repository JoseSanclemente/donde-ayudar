import { type Center, isExpired } from "../centers";
import { distanceMeters } from "../cluster";
import { getCenters, onCenters } from "../data/centers";
import { readCachedCoords, type Coords } from "../geolocation";
import { $, scheduleRender } from "../ui/dom";
import { paintTime } from "../ui/time";
import { prefillCenter } from "./center-form";
import { getUserCoords } from "./user-location";

/**
 * The already-published collection points the acopio form offers back — the
 * JavaScript half of `src/components/CenterHistory.astro`.
 *
 * It comes off the store that is already loaded, and it only lists what
 * `isExpired` says: a community `acopio` nobody has confirmed in a day. A point
 * still being confirmed needs no form at all — its popup has the button that
 * revives it, which is one tap and no typing.
 *
 * The whole card is the button and it does one thing: fill the form with what
 * that point said the last time. Publishing is a new row, not a revival, and the
 * card says so — reposting a point that went quiet and confirming a live one are
 * not the same act.
 */

/**
 * How many points a batch shows. Every one of them is offered — the same
 * warehouse is registered again and again, and cutting the list at six hides
 * exactly the point somebody is looking for — but not all at once: dozens of
 * cards unfolded turn the shortcut into the longest form on the page.
 */
const PAGE = 6;

type Item = {
  center: Center;
  /** `null` when we do not know where whoever is looking stands. */
  distanceM: number | null;
};

/**
 * The live position first and the cached one after: here «a 300 m» is written,
 * no «you are here» is drawn, so a coordinate from the previous visit does just
 * as well and arrives without waiting for the permission.
 */
function anchor(): Coords | null {
  return getUserCoords() ?? readCachedCoords();
}

/**
 * The most recently published first, without filtering by distance. The distance
 * is shown but does not decide: cutting by radius empties the list without
 * saying why as soon as whoever looks is far away.
 *
 * By `createdAt` and not by `updatedAt`, which is what the map sorts nothing by
 * and what `confirm_center` moves: here the question is which points were opened
 * last, and a point confirmed once by a passer-by would otherwise jump over the
 * one registered this morning.
 */
function pickItems(): Item[] {
  const at = anchor();
  return getCenters()
    .filter(isExpired)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((center) => ({
      center,
      distanceM: at ? distanceMeters(at, center) : null,
    }));
}

function formatDistance(meters: number): string {
  return meters < 1000 ? `a ${Math.round(meters)} m` : `a ${(meters / 1000).toFixed(1)} km`;
}

export function initCenterHistory(): void {
  const section = $<HTMLDetailsElement>("center-history");
  const count = $<HTMLSpanElement>("center-history-count");
  const list = $<HTMLUListElement>("center-history-list");
  const more = $<HTMLButtonElement>("center-history-more");

  /** How many cards are unfolded right now. Grows by taps, never shrinks. */
  let shown = PAGE;

  function buildItem({ center, distanceM }: Item): HTMLLIElement {
    const item = document.createElement("li");

    // The whole card is the button: on a phone, held in one hand and in the
    // rain, the target has to be the card and not a line of text inside it.
    const card = document.createElement("button");
    card.type = "button";
    card.className =
      "block w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-left transition hover:border-red-400 hover:bg-red-50/40 focus:outline-none focus:ring-2 focus:ring-red-300";
    item.append(card);

    const title = document.createElement("p");
    title.className = "text-sm font-semibold text-slate-900";
    title.textContent = center.name;
    card.append(title);

    const address = document.createElement("p");
    address.className = "text-xs text-slate-600";
    address.textContent = center.address;
    card.append(address);

    const meta = document.createElement("p");
    meta.className = "mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-slate-400";

    // The publication date and not the last confirmation: it is what the list is
    // sorted by, and an order nobody can read is not an order.
    const time = document.createElement("span");
    paintTime(time, center.createdAt, "Registrado ");
    meta.append(time);

    if (distanceM !== null) {
      const distance = document.createElement("span");
      distance.textContent = formatDistance(distanceM);
      meta.append(distance);
    }

    // Every point on this list is expired by construction, so the badge is fixed:
    // whoever taps has to know the map is showing that square grey.
    const badge = document.createElement("span");
    badge.className = "font-medium text-amber-600";
    badge.textContent = "sin confirmar hace más de un día";
    meta.append(badge);

    card.append(meta);

    card.addEventListener("click", () => {
      prefillCenter({
        name: center.name,
        address: center.address,
        lat: center.lat,
        lng: center.lng,
        hours: center.hours,
        donations: center.donations,
        contactWhatsapp: center.contactWhatsapp,
        contactInstagram: center.contactInstagram,
        notes: center.notes,
      });
      // The place chosen, the list has nothing left to say and the filled form
      // is what has to be seen.
      section.open = false;
    });

    return item;
  }

  function render(): void {
    const items = pickItems();
    list.replaceChildren(...items.slice(0, shown).map(buildItem));

    // The count is the whole list and not what is unfolded: the header is what
    // says whether it is worth opening.
    count.textContent = items.length > 0 ? String(items.length) : "";
    section.hidden = items.length === 0;

    const rest = items.length - shown;
    more.hidden = rest <= 0;
    if (rest > 0) more.textContent = `Ver ${rest} más`;
  }

  more.addEventListener("click", () => {
    shown += PAGE;
    render();
  });

  const scheduled = scheduleRender(render);
  onCenters(scheduled);

  render();
}
