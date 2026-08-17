import type { ButtonHTMLAttributes, FC, MouseEvent } from "react";
import { chipClass, COVERED_CHIP } from "@/scripts/resources";
import { escapeHtml } from "@/scripts/ui/html";

export const CHIP_SHAPE = "rounded-full border px-2 py-0.5 text-sm font-medium";

export interface ChipResource {
  name: string;
  covered: boolean;
  reportIds: string[];
}

export function chipStyle(resource: string, covered: boolean): string {
  return `${CHIP_SHAPE} ${covered ? COVERED_CHIP : chipClass(resource)}`;
}

export function chipLabel(resource: string, covered: boolean): string {
  return covered ? `✓ ${resource}` : resource;
}

export interface ResourceChipProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "resource"> {
  resource: ChipResource;
  onToggleCovered?: (resource: ChipResource) => void;
}

/**
 * Resource chip component representing a needed or covered aid item.
 */
export const ResourceChip: FC<ResourceChipProps> = ({
  resource,
  onToggleCovered,
  className = "",
  onClick,
  ...buttonProps
}) => {
  const { name, covered, reportIds } = resource;
  const action = covered
    ? `Volver a marcar ${name} como necesario`
    : `Marcar ${name} como cubierto`;

  const baseClass = `${chipStyle(name, covered)} transition hover:opacity-70`;
  const combinedClass = className ? `${baseClass} ${className}` : baseClass;

  const handleClick = (e: MouseEvent<HTMLButtonElement>) => {
    onClick?.(e);
    if (!e.defaultPrevented) {
      onToggleCovered?.(resource);
    }
  };

  return (
    <button
      type="button"
      className={combinedClass}
      aria-pressed={covered}
      aria-label={action}
      title={action}
      data-cover-resource={name}
      data-report-ids={reportIds.join(",")}
      data-covered={String(covered)}
      onClick={handleClick}
      {...buttonProps}
    >
      {chipLabel(name, covered)}
    </button>
  );
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
