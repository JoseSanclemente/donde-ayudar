import gsap from "gsap";
import { CATEGORIES, CHIP_OFF, chipClass, chipOnClass } from "../resources";
import { $, clearError, showError } from "../ui/dom";

/**
 * El selector de insumos del catálogo. Lo comparten el reporte de una necesidad
 * —qué falta en esa cuadra— y el registro de un punto de acopio —qué reciben
 * ahí—: los dos nombran la misma cosa, y por eso los dos guardan el mismo texto.
 *
 * Es una fábrica, como `location-picker`, y por la misma razón: los dos
 * formularios están en el DOM al mismo tiempo, así que cada uno recibe su
 * prefijo de ids. Lo que no comparten es cuándo se pliega — eso lo decide cada
 * formulario desde su propia pestaña.
 */
export type ResourcePicker = {
  /** Lo elegido, en el orden en que se fue eligiendo. */
  values(): string[];
  /** Vacía la selección y repinta. Va con el `form.reset()`. */
  clear(): void;
  /** Cierra las siete categorías, sin perder lo marcado. */
  collapse(): void;
  showError(message: string): void;
  clearError(): void;
};

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function createResourcePicker(prefix: string): ResourcePicker {
  const presetChips = $<HTMLDivElement>(`${prefix}-preset-chips`);
  const selectedResources = $<HTMLDivElement>(`${prefix}-selected-resources`);
  const resourcesError = $<HTMLParagraphElement>(`${prefix}-resources-error`);

  const resources = new Set<string>();

  // El formulario no se destruye al cerrarlo, así que las categorías conservan
  // lo que se dejó abierto la vez pasada y abrirlo de nuevo empieza a media
  // altura. Plegarlas no pierde nada: lo elegido sigue en `resources`, se ve en
  // los chips de abajo y la cuenta del encabezado lo dice sin desplegar.
  function collapse() {
    presetChips.querySelectorAll("details").forEach((panel) => {
      panel.open = false;
    });
  }

  function syncPresetChips() {
    presetChips.querySelectorAll<HTMLButtonElement>("[data-preset]").forEach((chip) => {
      const active = resources.has(chip.dataset.preset as string);
      chip.className = active ? chipOnClass(chip.dataset.category) : CHIP_OFF;
      chip.setAttribute("aria-pressed", String(active));
    });
    syncCategoryCounts();
  }

  // Las categorías cerradas esconderían lo ya seleccionado, así que el encabezado
  // lleva la cuenta de lo elegido dentro.
  function syncCategoryCounts() {
    for (const category of CATEGORIES) {
      const badge = presetChips.querySelector<HTMLElement>(`[data-count="${category.id}"]`);
      if (!badge) continue;
      const selected = category.items.filter((item) => resources.has(item.trim())).length;
      badge.textContent =
        selected === 0
          ? String(category.items.length)
          : selected === 1
            ? "1 elegido"
            : `${selected} elegidos`;
      // Sin color propio: el encabezado ya va tintado con el de la categoría y
      // un rojo encima competiría con él. Lo elegido se marca con el peso.
      badge.className = selected > 0 ? "text-xs font-bold" : "text-xs opacity-70";
    }
  }

  function renderSelectedResources() {
    selectedResources.replaceChildren();
    for (const resource of resources) {
      const tag = document.createElement("span");
      tag.className = `inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${chipClass(resource)}`;
      tag.textContent = resource;

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "opacity-50 transition hover:opacity-100";
      remove.setAttribute("aria-label", `Quitar ${resource}`);
      remove.textContent = "×";
      remove.addEventListener("click", () => toggleResource(resource, false));

      tag.append(remove);
      selectedResources.append(tag);
    }
    if (resources.size > 0) clearError(resourcesError);
    syncPresetChips();
  }

  function toggleResource(resource: string, force?: boolean) {
    const shouldAdd = force ?? !resources.has(resource);
    if (shouldAdd) resources.add(resource);
    else resources.delete(resource);
    renderSelectedResources();
  }

  presetChips.addEventListener("click", (event) => {
    const chip = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-preset]");
    if (!chip) return;
    toggleResource(chip.dataset.preset as string);
    if (!reduceMotion) {
      gsap.fromTo(chip, { scale: 0.92 }, { scale: 1, duration: 0.25, ease: "back.out(3)" });
    }
  });

  collapse();
  renderSelectedResources();

  return {
    values: () => [...resources],
    clear() {
      resources.clear();
      renderSelectedResources();
    },
    collapse,
    showError: (message) => showError(resourcesError, message),
    clearError: () => clearError(resourcesError),
  };
}
