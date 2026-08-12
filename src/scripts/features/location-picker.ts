import type { LatLng } from "leaflet";
import { debounce, geocode, type GeocodeResult } from "../geocode";
import { flyTo, hideDraft, isPicking, showDraft, startPicking, stopPicking } from "../map";
import { closeSheet, getSheetCover, openSheet, peekSheet } from "../sheet";
import { $, clearError, showError } from "../ui/dom";
import { hidePickHint, showPickHint } from "../ui/pick-hint";

/**
 * Dirección escrita, sugerencias, pin arrastrable y clic en el mapa: la mitad
 * en JavaScript de `src/components/LocationField.astro`.
 *
 * Vive aparte porque hay dos formularios —reportar una necesidad y registrar un
 * punto de acopio— que preguntan la misma dirección de la misma manera. Los dos
 * están en el DOM al mismo tiempo, así que cada uno recibe su prefijo de ids.
 *
 * El pin provisional y el modo «clic en el mapa» sí son únicos: viven en
 * `map.ts` y no hay dos. Por eso `suspend()` y `resume()`, que la pestaña llama
 * al cambiar: el que se va suelta el pin, el que llega lo vuelve a poner donde
 * lo tenía.
 */

const CALCULATED_NOTE =
  "Punto calculado desde la esquina y los metros de la placa. La mitad de las veces cae a menos de 25 m del edificio: arrastra el punto si no queda encima.";

const APPROX_NOTE =
  "Solo se pudo ubicar la vía, no el número. Arrastra el punto o usa «Ubicar en el mapa» para ponerlo sobre el edificio.";

const BADGES: Partial<Record<GeocodeResult["precision"], string>> = {
  calculada: "calculada — desde la esquina",
  aproximada: "aproximada — vía sin numeración",
};

export type Coords = { lat: number; lng: number };

export type LocationPicker = {
  /** El punto fijado, o `null` si todavía no hay ninguno. */
  getCoords(): Coords | null;
  /** Lo escrito en el campo de dirección, sin espacios sobrantes. */
  getName(): string;
  /** Falta la ubicación: lo dice, abre el modo de señalar y devuelve `null`. */
  requireCoords(): Coords | null;
  showNameError(message: string): void;
  clearNameError(): void;
  /** Después de enviar: campo vacío, sin pin, sin sugerencias, sin nota. */
  reset(): void;
  /** El formulario deja de verse: suelta el pin y el modo de señalar. */
  suspend(): void;
  /** El formulario vuelve a verse: repone el pin donde estaba. */
  resume(): void;
};

export function createLocationPicker(prefix: string): LocationPicker {
  const nameInput = $<HTMLInputElement>(`${prefix}-name`);
  const nameError = $<HTMLParagraphElement>(`${prefix}-name-error`);
  const suggestions = $<HTMLUListElement>(`${prefix}-suggestions`);
  const locationStatus = $<HTMLSpanElement>(`${prefix}-location-status`);
  const pickButton = $<HTMLButtonElement>(`${prefix}-pick-on-map`);
  const geoNote = $<HTMLParagraphElement>(`${prefix}-geo-note`);

  let coords: Coords | null = null;
  let geocodeAbort: AbortController | null = null;
  /** Solo el formulario a la vista puede tocar el pin y el modo de señalar. */
  let active = true;

  function paintStatus(next: Coords | null, source?: string) {
    if (!next) {
      locationStatus.textContent = "sin fijar";
      locationStatus.className = "font-semibold text-slate-800";
      return;
    }
    locationStatus.textContent = source
      ? `fijada — ${source}`
      : `fijada — ${next.lat.toFixed(5)}, ${next.lng.toFixed(5)}`;
    locationStatus.className = "font-semibold text-emerald-700";
  }

  function drawDraft(at: Coords) {
    // Pin provisional arrastrable: OSM casi nunca tiene el edificio exacto,
    // así que el ajuste fino siempre queda en manos de quien reporta.
    showDraft(at.lat, at.lng, (lat, lng) => {
      coords = { lat, lng };
      paintStatus(coords);
    });
  }

  function setCoords(next: Coords | null, source?: string) {
    coords = next;
    paintStatus(next, source);
    if (!active) return;
    if (next) drawDraft(next);
    else hideDraft();
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
          peekSheet();
        } else if (result.precision === "calculada") {
          // El punto ya está sobre la manzana correcta: basta con poder
          // arrastrarlo, no hace falta obligar a marcarlo desde cero.
          showNote(CALCULATED_NOTE);
          peekSheet();
        } else {
          showNote(APPROX_NOTE);
          // Acá no se baja el sheet: señalar en el mapa lo cierra entero, y las
          // dos posiciones se pelearían.
          beginPicking();
        }

        const zoom = { exacta: 18, calculada: 18, aproximada: 16 }[result.precision];
        // El pin va al centro de la franja de mapa que queda sobre el sheet: en
        // el centro del contenedor quedaría justo debajo del panel.
        void flyTo(result.lat, result.lng, zoom, getSheetCover() / 2);
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
    if (!active || isPicking()) return;
    pickButton.textContent = "Haz clic en el mapa…";
    pickButton.className =
      "shrink-0 rounded-md border border-red-500 bg-red-500 px-2.5 py-1.5 text-xs font-medium text-white";
    showNote("Haz clic en el mapa sobre el edificio. Luego puedes arrastrar el punto para afinarlo.");
    startPicking((latlng: LatLng) => {
      setCoords({ lat: latlng.lat, lng: latlng.lng });
      resetPickButton();
      hidePickHint();
      showNote("Punto fijado. Arrástralo si necesitas moverlo.");
      openSheet();
    });
    // En móvil el sheet tapa el mapa: hay que cerrarlo para poder señalar. Con
    // el sheet fuera, el aviso del header es lo único que queda diciendo qué
    // hacer y cómo salir — el botón rojo y la nota se fueron con el formulario.
    closeSheet();
    showPickHint(cancelPicking);
  }

  function cancelPicking() {
    stopPicking();
    resetPickButton();
    hidePickHint();
    clearNote();
    // Cancelar desde el aviso deja el mapa vacío: el formulario tiene que
    // volver. Desde el botón el sheet ya está abierto y esto no hace nada.
    openSheet();
  }

  function resetPickButton() {
    pickButton.textContent = "Ubicar en el mapa";
    pickButton.className =
      "shrink-0 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 transition hover:border-red-400 hover:text-red-600";
  }

  pickButton.addEventListener("click", () => {
    if (isPicking()) {
      cancelPicking();
      return;
    }
    hideSuggestions();
    beginPicking();
  });

  /* ---------------------------------------------------------------- */
  /* Lo que ve el formulario                                           */
  /* ---------------------------------------------------------------- */

  setCoords(null);

  return {
    getCoords: () => coords,
    getName: () => nameInput.value.trim(),

    requireCoords() {
      if (coords) return coords;
      showNote("Falta la ubicación — usa «Ubicar en el mapa» o elige una sugerencia.");
      beginPicking();
      return null;
    },

    showNameError(message) {
      showError(nameError, message);
    },

    clearNameError() {
      clearError(nameError);
    },

    reset() {
      nameInput.value = "";
      hideSuggestions();
      clearNote();
      clearError(nameError);
      stopPicking();
      resetPickButton();
      hidePickHint();
      setCoords(null);
    },

    suspend() {
      if (!active) return;
      active = false;
      stopPicking();
      resetPickButton();
      hidePickHint();
      hideSuggestions();
      // El pin se suelta, las coordenadas no: volver a la pestaña tiene que
      // encontrar el formulario tal como se dejó.
      hideDraft();
    },

    resume() {
      if (active) return;
      active = true;
      if (coords) drawDraft(coords);
    },
  };
}
