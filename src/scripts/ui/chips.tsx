import { escapeHtml } from "@/scripts/ui/html";
import {
  CHIP_SHAPE,
  chipLabel,
  chipStyle,
  ResourceChip,
  type ChipResource,
  type ResourceChipProps,
} from "@/components/ui/ResourceChip";

export {
  CHIP_SHAPE,
  chipStyle,
  chipLabel,
  ResourceChip,
  type ChipResource,
  type ResourceChipProps,
};

export default ResourceChip;

/**
 * Builds an HTMLButtonElement for imperative DOM rendering contexts.
 */
export function buildResourceChip(resource: ChipResource): HTMLButtonElement {
  const chip = document.createElement("button");
  const { name, covered, reportIds } = resource;
  const action = covered
    ? `Volver a marcar ${name} como necesario`
    : `Marcar ${name} como cubierto`;

  chip.type = "button";
  chip.className = `${chipStyle(name, covered)} transition hover:opacity-70`;
  chip.textContent = chipLabel(name, covered);
  chip.setAttribute("aria-pressed", String(covered));
  chip.setAttribute("aria-label", action);
  chip.title = action;
  chip.setAttribute("data-cover-resource", name);
  chip.setAttribute("data-report-ids", reportIds.join(","));
  chip.setAttribute("data-covered", String(covered));
  return chip;
}

/**
 * Generates an HTML button string for Leaflet popups and template interpolation.
 */
export function resourceChipHtml(resource: ChipResource): string {
  const { name, covered, reportIds } = resource;
  const action = covered
    ? `Volver a marcar ${name} como necesario`
    : `Marcar ${name} como cubierto`;
  const className = `${chipStyle(name, covered)} transition hover:opacity-70`;
  const label = chipLabel(name, covered);
  const ids = reportIds.join(",");

  return `<button
      type="button"
      data-cover-resource="${escapeHtml(name)}"
      data-report-ids="${escapeHtml(ids)}"
      data-covered="${String(covered)}"
      class="${className}"
      aria-pressed="${String(covered)}"
      aria-label="${escapeHtml(action)}"
      title="${escapeHtml(action)}"
    >${escapeHtml(label)}</button>`;
}
