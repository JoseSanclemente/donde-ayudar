import { $ } from "../ui/dom";

/**
 * Las dos pestañas de `ReportTabs.astro`: reportar una necesidad o registrar un
 * punto de acopio.
 *
 * Vive aparte de `sheet.ts` a propósito. Aquello gobierna qué panel del sheet se
 * ve; esto es estado de un solo panel, y meterlo allá obligaría a que el sheet
 * supiera de formularios. Lo único que sí importa afuera es el aviso: el pin
 * arrastrable y el modo «clic en el mapa» son únicos, así que el formulario que
 * se va tiene que soltarlos.
 */

export type ReportTab = "necesidad" | "acopio";

const watchers = new Set<(tab: ReportTab) => void>();

let container: HTMLDivElement | null = null;

export function currentReportTab(): ReportTab {
  return (container?.dataset.reportTab as ReportTab) ?? "necesidad";
}

export function onReportTabChange(fn: (tab: ReportTab) => void): void {
  watchers.add(fn);
}

export function showReportTab(tab: ReportTab): void {
  if (!container || currentReportTab() === tab) return;
  container.dataset.reportTab = tab;
  for (const button of container.querySelectorAll<HTMLButtonElement>("[data-report-tab-btn]")) {
    button.setAttribute("aria-selected", String(button.dataset.reportTabBtn === tab));
  }
  for (const fn of watchers) fn(tab);
}

export function initReportTabs(): void {
  container = $<HTMLDivElement>("report-tabs");
  container.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-report-tab-btn]");
    if (!button) return;
    showReportTab(button.dataset.reportTabBtn as ReportTab);
  });
}
