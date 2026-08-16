/**
 * Centers — collection points, shelters, blood banks, healthcare points and
 * municipalities asking for help. Never editable from the interface, whoever
 * published them.
 *
 * This module is only the shape of one. They live in the `centers` table;
 * reading them is `data/centers.ts`, and drawing them is `map.ts`.
 */
import { hoursSince } from "./ui/time";

export type CenterType =
  | "acopio"
  | "albergue"
  | "sangre"
  | "healthcare"
  | "municipio";

export type Origin = "curado" | "comunidad";

export type Center = {
  id: string;
  type: CenterType;
  name: string;
  address: string;
  lat: number;
  lng: number;
  hours: string;
  contactWhatsapp?: string;
  contactInstagram?: string;
  notes?: string;
  origin: Origin;
  /** A community point's author, so they can delete their own. Curated: none. */
  userId: string | null;
  /**
   * Supply names from the `resources.ts` catalog — the same ones a report asks
   * for. Optional for every type, and empty is a normal value.
   */
  donations: string[];
  /** `false` = open, not taking donations right now. Only a line in the popup. */
  acceptingDonations: boolean;
  /** `false` greys the marker out. The point stays on the map. */
  isActive: boolean;
  /** Also the expiry clock — see `isExpired`. */
  updatedAt: string;
  /** When it was published. Never moves: `confirm_center` only touches `updated_at`. */
  createdAt: string;
};

export function isCommunity(center: Center): boolean {
  return center.origin === "comunidad";
}

/**
 * A full day, the same a report pin gets (`IDLE_HOURS` in `status.ts`). A
 * warehouse that took donations one afternoon is a different question the next
 * morning and nobody goes back to the site to close it, so the point does have
 * to expire — but a day is what makes the two halves of the map age at the same
 * rate.
 */
export const EXPIRY_HOURS = 24;

/**
 * Nobody has touched this point in `EXPIRY_HOURS`, so the map stops showing it
 * as open — grey, and one tap away from coming back.
 *
 * Only a community `acopio`. A curated point is a maintainer's; a shelter has
 * people sleeping in it and a blood bank keeps hospital hours — none of them is
 * the improvised thing that opens for an afternoon.
 */
export function isExpired(center: Center): boolean {
  return (
    center.type === "acopio" && isCommunity(center) && hoursSince(center.updatedAt) >= EXPIRY_HOURS
  );
}

/**
 * How long a `municipio` stays on the map. It is not `EXPIRY_HOURS` because it
 * does not measure the same thing: a collection point expires because nobody
 * closed it and anyone walking past can reopen it, while a municipality expires
 * because the reporting it was read out of gets old, and nobody walks past a
 * municipality. Only a maintainer redoing the news sweep can answer for it.
 */
export const MUNICIPIO_DAYS = 30;

/**
 * The month is up and nobody re-ran the sweep, so the point comes off the map.
 *
 * It disappears instead of going grey, which is what an expired collection
 * point does. A grey square says «this place exists, do not walk over there
 * yet», and that is true of a warehouse; here what aged is the claim itself —
 * that this municipality still needs what it needed a month ago — and a map
 * that cannot back a claim should stop making it.
 */
export function isLapsed(center: Center): boolean {
  return (
    center.type === "municipio" && hoursSince(center.updatedAt) >= MUNICIPIO_DAYS * 24
  );
}
