import { chipClass, COVERED_CHIP } from "../resources";

/** Forma del chip en la lista; el color lo pone `resources.ts`. */
export const CHIP_SHAPE = "rounded-full px-2 py-0.5 text-xs font-medium";

export function chipStyle(resource: string, covered: boolean): string {
  return `${CHIP_SHAPE} ${covered ? COVERED_CHIP : chipClass(resource)}`;
}

export function chipLabel(resource: string, covered: boolean): string {
  return covered ? `✓ ${resource}` : resource;
}
