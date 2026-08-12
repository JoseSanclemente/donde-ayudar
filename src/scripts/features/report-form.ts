import gsap from "gsap";
import { addReport } from "../data/reports";
import { flyTo, getMarkerElement } from "../map";
import { CATEGORIES, CHIP_OFF, chipClass, chipOnClass } from "../resources";
import { closeReportPanel, closeSheet, isTabVisible, onTabChange } from "../sheet";
import { isValidPhone } from "../ui/contact";
import { $, clearError, showError } from "../ui/dom";
import { createLocationPicker } from "./location-picker";
import { onReportTabChange } from "./report-tabs";

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function initReportForm(): void {
  const form = $<HTMLFormElement>("report-form");
  const presetChips = $<HTMLDivElement>("preset-chips");
  const selectedResources = $<HTMLDivElement>("selected-resources");
  const resourcesError = $<HTMLParagraphElement>("resources-error");
  const urgente = $<HTMLInputElement>("urgente");
  const note = $<HTMLTextAreaElement>("note");
  const contactName = $<HTMLInputElement>("contact-name");
  const contactPhone = $<HTMLInputElement>("contact-phone");
  const contactError = $<HTMLParagraphElement>("contact-error");

  // Dirección, sugerencias y pin arrastrable: los comparte con el formulario de
  // acopios, así que el prefijo de los ids es lo único propio.
  const location = createLocationPicker("report");
  const resources = new Set<string>();

  /* ---------------------------------------------------------------- */
  /* Chips de recursos                                                 */
  /* ---------------------------------------------------------------- */

  // El formulario no se destruye al cerrarlo, así que las categorías conservan
  // lo que se dejó abierto la vez pasada y abrirlo de nuevo empieza a media
  // altura. Plegarlas no pierde nada: lo elegido sigue en `resources`, se ve en
  // los chips de abajo y la cuenta del encabezado lo dice sin desplegar.
  function collapseCategories() {
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
      const selected = category.items.filter((item) => resources.has(item)).length;
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

  /* ---------------------------------------------------------------- */
  /* Envío                                                             */
  /* ---------------------------------------------------------------- */

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    let valid = true;

    const name = location.getName();
    if (!name) {
      location.showNameError("Escribe el nombre o la dirección del edificio.");
      valid = false;
    } else {
      location.clearNameError();
    }

    if (resources.size === 0) {
      showError(resourcesError, "Selecciona al menos un recurso.");
      valid = false;
    } else {
      clearError(resourcesError);
    }

    // Espejo de los CHECK de la base: mismo patrón y mismos largos. Sin esto,
    // un teléfono mal escrito vuelve como «no se pudo guardar el reporte» y no
    // hay forma de saber cuál de los campos estuvo mal.
    const person = contactName.value.trim();
    const phone = contactPhone.value.trim();
    if (phone && !person) {
      showError(contactError, "Escribe también un nombre: un número solo no dice por quién preguntar.");
      valid = false;
    } else if (person && person.length < 2) {
      showError(contactError, "El nombre del contacto es muy corto.");
      valid = false;
    } else if (phone && !isValidPhone(phone)) {
      showError(contactError, "Revisa el teléfono: solo números, espacios, + ( ) y guiones.");
      valid = false;
    } else {
      clearError(contactError);
    }

    const coords = location.requireCoords();
    if (!coords) valid = false;

    if (!valid || !coords) return;

    // addReport emite de inmediato, así que la lista ya dibujó el marcador.
    const report = addReport({
      name,
      lat: coords.lat,
      lng: coords.lng,
      resources: [...resources],
      status: urgente.checked ? "urgente" : "activo",
      note: note.value.trim() || null,
      contactName: person || null,
      contactPhone: person && phone ? phone : null,
    });

    form.reset();
    resources.clear();
    renderSelectedResources();
    location.reset();
    clearError(contactError);

    // Cerrar el sheet y el panel: lo que queda a la vista es el marcador
    // nuevo aterrizando, con el FAB de vuelta para el siguiente reporte.
    closeReportPanel();
    closeSheet();
    await flyTo(report.lat, report.lng);

    if (!reduceMotion) {
      const markerEl = getMarkerElement(report.id);
      if (markerEl) {
        gsap.fromTo(
          markerEl,
          { scale: 0, y: -40, opacity: 0 },
          { scale: 1, y: 0, opacity: 1, duration: 0.6, ease: "back.out(2)" },
        );
      }
      const item = document.querySelector<HTMLLIElement>(`[data-lead-id="${report.id}"]`);
      if (item) gsap.from(item, { opacity: 0, y: -12, duration: 0.4, ease: "power3.out" });
    }
  });

  // Cada vez que el formulario vuelve a la vista arranca plegado, venga del FAB
  // o de reabrir el sheet: quien lo abre busca la dirección primero, y las
  // categorías desplegadas empujan todo lo demás fuera de la pantalla.
  let wasVisible = isTabVisible("reportar");
  onTabChange(() => {
    const visible = isTabVisible("reportar");
    if (visible && !wasVisible) collapseCategories();
    wasVisible = visible;
  });

  // El pin y el modo de señalar son únicos en el mapa: solo puede tenerlos la
  // pestaña que se está viendo.
  onReportTabChange((tab) => {
    if (tab === "necesidad") location.resume();
    else location.suspend();
  });

  collapseCategories();
  renderSelectedResources();
}
