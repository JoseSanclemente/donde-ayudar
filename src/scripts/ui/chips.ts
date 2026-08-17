/**
 * The resource chip, in the two shapes it takes: an element for the list, which
 * builds its rows as DOM, and an HTML string for the map popup and — through it,
 * verbatim — the mobile sheet. Same reason as `ui/select.ts`: the control was
 * written by hand on each surface, and the toggle only existed on one of them.
 *
 * It knows neither the stores nor the features: nothing is listened to here, and
 * the resource arrives as plain fields so this file stays clear of `cluster.ts`.
 */
import { chipClass, COVERED_CHIP } from "../resources";
import { escapeHtml } from "./html";

export const CHIP_SHAPE = "rounded-full border px-2 py-0.5 text-sm font-medium";

export function chipStyle(resource: string, covered: boolean): string {
  return `${CHIP_SHAPE} ${covered ? COVERED_CHIP : chipClass(resource)}`;
}

export function chipLabel(resource: string, covered: boolean): string {
  return covered ? `✓ ${resource}` : resource;
}

export type ChipResource = {
  name: string;
  covered: boolean;
  reportIds: string[];
};

type ChipParts = {
  className: string;
  label: string;
  action: string;
  ids: string;
  covered: string;
};

function chipParts(resource: ChipResource): ChipParts {
  return {
    className: `${chipStyle(resource.name, resource.covered)} transition hover:opacity-70`,
    label: chipLabel(resource.name, resource.covered),
    action: resource.covered
      ? `Volver a marcar ${resource.name} como necesario`
      : `Marcar ${resource.name} como cubierto`,

    ids: resource.reportIds.join(","),
    covered: String(resource.covered),
  };
}

export function resourceChipHtml(resource: ChipResource): string {
  const parts = chipParts(resource);
  return `<button
      type="button"
      data-cover-resource="${escapeHtml(resource.name)}"
      data-report-ids="${escapeHtml(parts.ids)}"
      data-covered="${parts.covered}"
      class="${parts.className}"
      aria-pressed="${parts.covered}"
      aria-label="${escapeHtml(parts.action)}"
      title="${escapeHtml(parts.action)}"
    >${escapeHtml(parts.label)}</button>`;
}

export function buildResourceChip(resource: ChipResource): HTMLButtonElement {
  const parts = chipParts(resource);
  const chip = document.createElement("button");
  chip.type = "button";
  chip.className = parts.className;
  chip.textContent = parts.label;
  chip.setAttribute("aria-pressed", parts.covered);
  chip.setAttribute("aria-label", parts.action);
  chip.title = parts.action;
  return chip;
}
