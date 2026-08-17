/**
 * The «toca el mapa» bar in the header (`src/components/PickHint.astro`). Pure
 * DOM: whoever arms pick mode decides what «Cancelar» does and passes it in.
 * There is a single bar because there is a single pick mode, even though two
 * forms can start it.
 */

let bar: HTMLDivElement | null = null;
let cancelButton: HTMLButtonElement | null = null;
let onCancelClick: (() => void) | null = null;

function mount(): boolean {
  if (bar) return true;
  bar = document.getElementById("pick-hint") as HTMLDivElement | null;
  if (!bar) return false;
  cancelButton = document.getElementById(
    "pick-hint-cancel",
  ) as HTMLButtonElement | null;

  cancelButton?.addEventListener("click", () => onCancelClick?.());
  return true;
}

export function showPickHint(onCancel: () => void): void {
  if (!mount() || !bar) return;
  onCancelClick = onCancel;
  bar.hidden = false;
}

export function hidePickHint(): void {
  if (!mount() || !bar) return;
  onCancelClick = null;
  bar.hidden = true;
}
