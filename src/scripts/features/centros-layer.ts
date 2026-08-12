import { getCentros, onCentros } from "../data/centros";
import { setCentros } from "../map";

/**
 * Curated layer: this file only draws it. There is no way to add a point from
 * the UI, nor to filter them — they are a fixed layer of the map.
 *
 * It subscribes rather than drawing once, because the list stopped being build
 * data: a maintainer pausing a center in Supabase has to reach the map of
 * whoever is already looking at it, not the next deploy. The first call paints
 * whatever the store already has (nothing, on a cold boot) and the subscription
 * takes over from the initial load onwards.
 */
export function initCentrosLayer(): void {
  setCentros(getCentros());
  onCentros(setCentros);
}
