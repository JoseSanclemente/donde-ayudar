import type { Center } from "../centers";
import { getCenters, onCenters } from "../data/centers";
import { isMine } from "../data/session";
import { setCenters } from "../map";

/**
 * The centers layer: this file only draws it.
 *
 * It subscribes instead of painting once, because the list stopped being build
 * data: a maintainer who greys a center out in Supabase has to reach the map of
 * whoever is already looking, not the next deploy.
 *
 * Who owns each point is decided here too. `map.ts` cannot ask the session —
 * it is domain, it does not touch `data/` — so the answer comes down as one
 * more piece of data, like `MarkerExtra` does for the reports.
 */
function paint(list: Center[]): void {
  setCenters(list.map((data) => ({ data, mine: isMine(data) })));
}

/**
 * How often it repaints without the store having changed. A community point
 * expires by clock and not by event: without this, the tab left open last night
 * still shows as open, at nine in the morning, a point that expired at three.
 */
const REPAINT_MS = 5 * 60_000;

export function initCentersLayer(): void {
  paint(getCenters());
  onCenters(paint);
  setInterval(() => paint(getCenters()), REPAINT_MS);
}
