/**
 * Centers — collection points, shelters, blood banks and healthcare points.
 * Never editable from the interface, whoever published them.
 *
 * This module is only the shape of one. They live in the `centers` table;
 * reading them is `data/centers.ts`, and drawing them is `map.ts`.
 */
import { hoursSince } from "./ui/time";

export type CenterType = "acopio" | "albergue" | "sangre" | "healthcare";

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
