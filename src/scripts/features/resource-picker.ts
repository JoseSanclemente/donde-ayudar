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
  /** Cierra las categorías, sin perder lo marcado. */
  collapse(): void;
  showError(message: string): void;
  clearError(): void;
};

export type ResourcePickerOptions = {
  /**
   * Cuántos insumos caben. Es el `check` de la columna donde van a parar:
   * veinte en `reports.resources`, ochenta en `centers.donations`. Sin el freno
   * acá, pasarse vuelve como «no se pudo guardar» y nadie sabe por qué.
   */
  max: number;
};

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function createResourcePicker(
  prefix: string,
  { max }: ResourcePickerOptions,
): ResourcePicker {
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
    syncSelectAllButtons();
  }

  /** Marcada entera, el botón se ofrece a desmarcarla. */
  function isWholeCategorySelected(items: string[]): boolean {
    return items.every((item) => resources.has(item.trim()));
  }

  function syncSelectAllButtons() {
    for (const category of CATEGORIES) {
      const button = presetChips.querySelector<HTMLButtonElement>(
        `[data-select-all="${category.id}"]`,
      );
      if (!button) continue;
      const whole = isWholeCategorySelected(category.items);
      button.textContent = whole ? "Quitar todo" : "Seleccionar todo";
      button.setAttribute("aria-pressed", String(whole));
    }
  }

  /**
   * Toda la categoría de un toque. Quien reporta un edificio entero necesita
   * media familia de insumos, no un chip: veinticinco toques con el celular en
   * una mano no los da nadie en la calle.
   */
  function toggleCategory(categoryId: string) {
    const category = CATEGORIES.find((c) => c.id === categoryId);
    if (!category) return;
    const items = category.items.map((item) => item.trim());

    if (isWholeCategorySelected(category.items)) {
      for (const item of items) resources.delete(item);
      renderSelectedResources();
      return;
    }

    let full = false;
    for (const item of items) {
      if (resources.size >= max && !resources.has(item)) {
        full = true;
        continue;
      }
      resources.add(item);
    }

    // Lo que cupo queda marcado: devolver la categoría vacía porque sobraban
    // tres ítems obligaría a marcarlos a mano, que es lo que este botón vino a
    // evitar. El aviso va después de repintar, que es quien limpia el error.
    renderSelectedResources();
    if (full) showError(resourcesError, `Máximo ${max} insumos.`);
  }

  function renderSelectedResources() {
    selectedResources.replaceChildren();
    for (const resource of resources) {
      const tag = document.createElement("span");
      tag.className = `inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium ${chipClass(resource)}`;
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
    if (shouldAdd) {
      if (resources.size >= max && !resources.has(resource)) {
        showError(resourcesError, `Máximo ${max} insumos.`);
        return;
      }
      resources.add(resource);
    } else {
      resources.delete(resource);
    }
    renderSelectedResources();
  }

  presetChips.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;

    // El botón vive dentro del `summary`, y el clic en un `summary` pliega el
    // acordeón: sin esto, marcar la categoría entera la cierra en la cara.
    const selectAll = target.closest<HTMLButtonElement>("[data-select-all]");
    if (selectAll) {
      event.preventDefault();
      const categoryId = selectAll.dataset.selectAll as string;
      toggleCategory(categoryId);
      if (!reduceMotion) {
        const chips = presetChips.querySelectorAll(`[data-preset][data-category="${categoryId}"]`);
        gsap.fromTo(
          chips,
          { scale: 0.92 },
          { scale: 1, duration: 0.25, ease: "back.out(3)", stagger: 0.02 },
        );
      }
      return;
    }

    const chip = target.closest<HTMLButtonElement>("[data-preset]");
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
