import gsap from "gsap";
import type { LatLng } from "leaflet";
import { addReport } from "../data/reports";
import { debounce, geocode, type GeocodeResult } from "../geocode";
import {
  flyTo,
  getMarkerElement,
  hideDraft,
  isPicking,
  showDraft,
  startPicking,
  stopPicking,
} from "../map";
import { CATEGORIES, CHIP_OFF, chipClass, chipOnClass } from "../resources";
import { closeReportPanel, closeSheet, openSheet } from "../sheet";
import { isValidPhone } from "../ui/contact";
import { $, clearError, showError } from "../ui/dom";

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const CALCULATED_NOTE =
  "Punto calculado desde la esquina y los metros de la placa. La mitad de las veces cae a menos de 25 m del edificio: arrastra el punto si no queda encima.";

const APPROX_NOTE =
  "Solo se pudo ubicar la vía, no el número. Arrastra el punto o usa «Ubicar en el mapa» para ponerlo sobre el edificio.";

const BADGES: Partial<Record<GeocodeResult["precision"], string>> = {
  calculada: "calculada — desde la esquina",
  aproximada: "aproximada — vía sin numeración",
};

export function initReportForm(): void {
  const form = $<HTMLFormElement>("report-form");
  const nameInput = $<HTMLInputElement>("name");
  const nameError = $<HTMLParagraphElement>("name-error");
  const suggestions = $<HTMLUListElement>("suggestions");
  const locationStatus = $<HTMLSpanElement>("location-status");
  const pickButton = $<HTMLButtonElement>("pick-on-map");
  const geoNote = $<HTMLParagraphElement>("geo-note");
  const presetChips = $<HTMLDivElement>("preset-chips");
  const selectedResources = $<HTMLDivElement>("selected-resources");
  const resourcesError = $<HTMLParagraphElement>("resources-error");
  const urgente = $<HTMLInputElement>("urgente");
  const note = $<HTMLTextAreaElement>("note");
  const noteCount = $<HTMLSpanElement>("note-count");
  const contactName = $<HTMLInputElement>("contact-name");
  const contactPhone = $<HTMLInputElement>("contact-phone");
  const contactError = $<HTMLParagraphElement>("contact-error");

  note.addEventListener("input", () => {
    noteCount.textContent = String(note.value.length);
  });

  let coords: { lat: number; lng: number } | null = null;
  const resources = new Set<string>();
  let geocodeAbort: AbortController | null = null;

  function setCoords(next: { lat: number; lng: number } | null, source?: string) {
    coords = next;
    if (next) {
      locationStatus.textContent = source
        ? `fijada — ${source}`
        : `fijada — ${next.lat.toFixed(5)}, ${next.lng.toFixed(5)}`;
      locationStatus.className = "font-semibold text-emerald-700";
      // Pin provisional arrastrable: OSM casi nunca tiene el edificio exacto,
      // así que el ajuste fino siempre queda en manos de quien reporta.
      showDraft(next.lat, next.lng, (lat, lng) => {
        coords = { lat, lng };
        locationStatus.textContent = `fijada — ${lat.toFixed(5)}, ${lng.toFixed(5)}`;
      });
    } else {
      locationStatus.textContent = "sin fijar";
      locationStatus.className = "font-semibold text-slate-800";
      hideDraft();
    }
  }

  function showNote(message: string) {
    geoNote.textContent = message;
    geoNote.classList.remove("hidden");
  }

  function clearNote() {
    geoNote.textContent = "";
    geoNote.classList.add("hidden");
  }

  /* ---------------------------------------------------------------- */
  /* Chips de recursos                                                 */
  /* ---------------------------------------------------------------- */

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
      badge.className =
        selected > 0 ? "text-xs font-semibold text-red-600" : "text-xs text-slate-400";
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
  /* Geocodificación                                                   */
  /* ---------------------------------------------------------------- */

  function hideSuggestions() {
    suggestions.replaceChildren();
    suggestions.classList.add("hidden");
  }

  function renderSuggestions(results: GeocodeResult[]) {
    suggestions.replaceChildren();
    for (const result of results) {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "block w-full px-3 py-2 text-left transition hover:bg-red-50";

      const title = document.createElement("span");
      title.className = "block text-xs font-medium text-slate-800";
      title.textContent = result.label;
      button.append(title);

      if (result.detail) {
        const detail = document.createElement("span");
        detail.className = "block text-[11px] text-slate-500";
        detail.textContent = result.detail;
        button.append(detail);
      }

      const badge = BADGES[result.precision];
      if (badge) {
        const element = document.createElement("span");
        element.className = "mt-0.5 inline-block text-[11px] text-amber-600";
        element.textContent = badge;
        button.append(element);
      }

      button.addEventListener("click", () => {
        const source = {
          exacta: "dirección encontrada",
          calculada: "calculada desde la esquina",
          aproximada: "vía aproximada",
        }[result.precision];

        setCoords({ lat: result.lat, lng: result.lng }, source);
        if (!nameInput.value.trim()) nameInput.value = result.label;
        hideSuggestions();

        if (result.precision === "exacta") {
          clearNote();
        } else if (result.precision === "calculada") {
          // El punto ya está sobre la manzana correcta: basta con poder
          // arrastrarlo, no hace falta obligar a marcarlo desde cero.
          showNote(CALCULATED_NOTE);
        } else {
          showNote(APPROX_NOTE);
          beginPicking();
        }

        const zoom = { exacta: 18, calculada: 18, aproximada: 16 }[result.precision];
        void flyTo(result.lat, result.lng, zoom);
      });
      item.append(button);
      suggestions.append(item);
    }
    suggestions.classList.toggle("hidden", results.length === 0);
  }

  /**
   * OpenStreetMap no tiene la mayoría de los edificios residenciales de Cali
   * (sí los tiene Google Maps, que es propietario). Buscar no es la vía
   * principal para ubicar: lo es el clic en el mapa.
   */
  function renderNoResults(query: string) {
    suggestions.replaceChildren();

    const item = document.createElement("li");
    item.className = "p-3";

    const text = document.createElement("p");
    text.className = "text-xs text-slate-600";
    text.textContent = `«${query}» no está en OpenStreetMap. Ubícalo a mano: haz clic en el mapa sobre el edificio.`;

    const action = document.createElement("button");
    action.type = "button";
    action.className =
      "mt-2 w-full rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-red-600";
    action.textContent = "Ubicar en el mapa";
    action.addEventListener("click", () => {
      hideSuggestions();
      beginPicking();
    });

    item.append(text, action);
    suggestions.append(item);
    suggestions.classList.remove("hidden");
  }

  const runGeocode = debounce(async (query: string) => {
    geocodeAbort?.abort();
    geocodeAbort = new AbortController();
    const signal = geocodeAbort.signal;
    try {
      const results = await geocode(query, signal);
      if (signal.aborted) return;
      if (results.length === 0) {
        renderNoResults(query);
        clearNote();
        beginPicking();
      } else {
        renderSuggestions(results);
        clearNote();
      }
    } catch (error) {
      if ((error as Error).name === "AbortError" || signal.aborted) return;
      renderNoResults(query);
      beginPicking();
    }
  }, 600);

  nameInput.addEventListener("input", () => {
    clearError(nameError);
    const query = nameInput.value.trim();
    if (query.length < 3) {
      hideSuggestions();
      return;
    }
    runGeocode(query);
  });

  document.addEventListener("click", (event) => {
    if (!suggestions.contains(event.target as Node) && event.target !== nameInput) {
      hideSuggestions();
    }
  });

  /* ---------------------------------------------------------------- */
  /* Señalar en el mapa                                                */
  /* ---------------------------------------------------------------- */

  function beginPicking() {
    if (isPicking()) return;
    pickButton.textContent = "Haz clic en el mapa…";
    pickButton.className =
      "shrink-0 rounded-md border border-red-500 bg-red-500 px-2.5 py-1.5 text-xs font-medium text-white";
    showNote(
      "Haz clic en el mapa sobre el edificio. Luego puedes arrastrar el punto para afinarlo.",
    );
    startPicking((latlng: LatLng) => {
      setCoords({ lat: latlng.lat, lng: latlng.lng });
      resetPickButton();
      showNote("Punto fijado. Arrástralo si necesitas moverlo.");
      openSheet();
    });
    // En móvil el sheet tapa el mapa: hay que cerrarlo para poder señalar.
    closeSheet();
  }

  function resetPickButton() {
    pickButton.textContent = "Ubicar en el mapa";
    pickButton.className =
      "shrink-0 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 transition hover:border-red-400 hover:text-red-600";
  }

  pickButton.addEventListener("click", () => {
    if (isPicking()) {
      stopPicking();
      resetPickButton();
      clearNote();
      return;
    }
    hideSuggestions();
    beginPicking();
  });

  /* ---------------------------------------------------------------- */
  /* Envío                                                             */
  /* ---------------------------------------------------------------- */

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    let valid = true;

    const name = nameInput.value.trim();
    if (!name) {
      showError(nameError, "Escribe el nombre o la dirección del edificio.");
      valid = false;
    } else {
      clearError(nameError);
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

    if (!coords) {
      showNote("Falta la ubicación — usa «Ubicar en el mapa» o elige una sugerencia.");
      beginPicking();
      valid = false;
    }

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

    hideSuggestions();
    clearNote();
    stopPicking();
    resetPickButton();

    form.reset();
    resources.clear();
    renderSelectedResources();
    setCoords(null);
    noteCount.textContent = "0";
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

  renderSelectedResources();
  setCoords(null);
}
