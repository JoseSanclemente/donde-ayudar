import gsap from "gsap";
import type { LatLng } from "leaflet";
import {
  addMarker,
  detachMarker,
  flyTo,
  getMarkerElement,
  hideDraft,
  initMap,
  isPicking,
  removeMarker,
  setCentroFilter,
  setCentros,
  setCentrosVisible,
  showDraft,
  startPicking,
  stopPicking,
  updateMarker,
} from "./map";
import { loadCentros } from "./centros";
import { debounce, geocode, type GeocodeResult } from "./geocode";
import { loadAddresses, loadStreets } from "./geo-index";
import {
  addReport,
  getReports,
  initStore,
  isMine,
  onChange,
  onError,
  onState,
  removeReport,
  setResourceCovered,
  type Report,
  type StoreState,
} from "./store";
import { collapseSheet, expandSheet, initSheet } from "./sheet";
import { CATEGORIES, CHIP_OFF, chipClass, chipOnClass, COVERED_CHIP } from "./resources";
import { groupReports, type ReportGroup } from "./cluster";

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ------------------------------------------------------------------ */
/* Elements                                                            */
/* ------------------------------------------------------------------ */

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const form = $<HTMLFormElement>("report-form");
const nameInput = $<HTMLInputElement>("name");
const nameError = $<HTMLParagraphElement>("name-error");
const suggestions = $<HTMLUListElement>("suggestions");
const locationStatus = $<HTMLSpanElement>("location-status");
const pickButton = $<HTMLButtonElement>("pick-on-map");
const geoNote = $<HTMLParagraphElement>("geo-note");
const presetChips = $<HTMLDivElement>("preset-chips");
const customResource = $<HTMLInputElement>("custom-resource");
const selectedResources = $<HTMLDivElement>("selected-resources");
const resourcesError = $<HTMLParagraphElement>("resources-error");
const reportList = $<HTMLUListElement>("report-list");
const reportCount = $<HTMLSpanElement>("report-count");
const emptyState = $<HTMLParagraphElement>("empty-state");

/* ------------------------------------------------------------------ */
/* Form state                                                          */
/* ------------------------------------------------------------------ */

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

function showError(el: HTMLElement, message: string) {
  el.textContent = message;
  el.classList.remove("hidden");
}

function clearError(el: HTMLElement) {
  el.textContent = "";
  el.classList.add("hidden");
}

function showNote(message: string) {
  geoNote.textContent = message;
  geoNote.classList.remove("hidden");
}

function clearNote() {
  geoNote.textContent = "";
  geoNote.classList.add("hidden");
}

/* ------------------------------------------------------------------ */
/* Resources chips                                                     */
/* ------------------------------------------------------------------ */

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
    badge.className = selected > 0 ? "text-xs font-semibold text-red-600" : "text-xs text-slate-400";
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

customResource.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  const value = customResource.value.trim();
  if (!value) return;
  toggleResource(value, true);
  customResource.value = "";
});

/* ------------------------------------------------------------------ */
/* Geocoding                                                           */
/* ------------------------------------------------------------------ */

function hideSuggestions() {
  suggestions.replaceChildren();
  suggestions.classList.add("hidden");
}

const CALCULATED_NOTE =
  "Punto calculado desde la esquina y los metros de la placa. La mitad de las veces cae a menos de 25 m del edificio: arrastra el punto si no queda encima.";

const APPROX_NOTE =
  "Solo se pudo ubicar la vía, no el número. Arrastra el punto o usa «Ubicar en el mapa» para ponerlo sobre el edificio.";

const BADGES: Partial<Record<GeocodeResult["precision"], string>> = {
  calculada: "calculada — desde la esquina",
  aproximada: "aproximada — vía sin numeración",
};

function renderSuggestions(results: GeocodeResult[]) {
  suggestions.replaceChildren();
  for (const result of results) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className =
      "block w-full px-3 py-2 text-left transition hover:bg-red-50";

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

/* ------------------------------------------------------------------ */
/* Pick on map                                                         */
/* ------------------------------------------------------------------ */

function beginPicking() {
  if (isPicking()) return;
  pickButton.textContent = "Haz clic en el mapa…";
  pickButton.className =
    "shrink-0 rounded-md border border-red-500 bg-red-500 px-2.5 py-1.5 text-xs font-medium text-white";
  showNote("Haz clic en el mapa sobre el edificio. Luego puedes arrastrar el punto para afinarlo.");
  startPicking((latlng: LatLng) => {
    setCoords({ lat: latlng.lat, lng: latlng.lng });
    resetPickButton();
    showNote("Punto fijado. Arrástralo si necesitas moverlo.");
    expandSheet();
  });
  // En móvil el sheet tapa el mapa: hay que bajarlo para poder señalar.
  collapseSheet();
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

/* ------------------------------------------------------------------ */
/* Report list                                                         */
/* ------------------------------------------------------------------ */

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diffMs / 60000);
  const formatter = new Intl.RelativeTimeFormat("es-CO", { numeric: "auto" });
  if (Math.abs(minutes) < 60) return formatter.format(-minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return formatter.format(-hours, "hour");
  return formatter.format(-Math.round(hours / 24), "day");
}

/** Claves de los grupos desplegados — sobreviven al re-render completo. */
const expanded = new Set<string>();

const CHIP_SHAPE = "rounded-full px-2 py-0.5 text-xs font-medium";

function chipStyle(resource: string, covered: boolean): string {
  return `${CHIP_SHAPE} ${covered ? COVERED_CHIP : chipClass(resource)}`;
}

function chipLabel(resource: string, covered: boolean): string {
  return covered ? `✓ ${resource}` : resource;
}

/** Chips de la zona: cada uno alterna «cubierto» en todos los reportes que lo piden. */
function buildGroupChips(group: ReportGroup): HTMLDivElement {
  const chips = document.createElement("div");
  chips.className = "mt-2 flex flex-wrap gap-1";
  for (const resource of group.resources) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = `${chipStyle(resource.name, resource.covered)} transition hover:opacity-70`;
    chip.textContent = chipLabel(resource.name, resource.covered);
    chip.setAttribute("aria-pressed", String(resource.covered));
    const action = resource.covered
      ? `Volver a marcar ${resource.name} como necesario`
      : `Marcar ${resource.name} como cubierto`;
    chip.title = action;
    chip.setAttribute("aria-label", action);
    chip.addEventListener("click", () =>
      setResourceCovered(resource.reportIds, resource.name, !resource.covered),
    );
    chips.append(chip);
  }
  return chips;
}

/** Chips de un reporte suelto: solo lectura, la acción vive a nivel de zona. */
function buildReportChips(report: Report): HTMLDivElement {
  const chips = document.createElement("div");
  chips.className = "mt-2 flex flex-wrap gap-1";
  const covered = new Set(report.covered);
  const ordered = [
    ...report.resources.filter((r) => !covered.has(r)),
    ...report.resources.filter((r) => covered.has(r)),
  ];
  for (const resource of ordered) {
    const chip = document.createElement("span");
    chip.className = chipStyle(resource, covered.has(resource));
    chip.textContent = chipLabel(resource, covered.has(resource));
    chips.append(chip);
  }
  return chips;
}

function buildDeleteButton(id: string): HTMLButtonElement {
  const del = document.createElement("button");
  del.type = "button";
  del.className = "text-xs font-medium text-slate-400 transition hover:text-red-600";
  del.textContent = "Eliminar";
  del.addEventListener("click", () => deleteReport(id));
  return del;
}

function buildMemberItem(report: Report): HTMLLIElement {
  const item = document.createElement("li");
  item.dataset.id = report.id;
  item.className = "rounded-lg border border-slate-200 bg-slate-50 p-2";

  const meta = document.createElement("div");
  meta.className = "flex items-center justify-between gap-2";

  const time = document.createElement("span");
  time.className = "text-xs text-slate-400";
  time.textContent = relativeTime(report.createdAt);

  // Solo el autor puede borrar (policy de RLS): mostrarle el botón a los demás
  // sería ofrecer una acción que el servidor va a rechazar.
  meta.append(time);
  if (isMine(report)) meta.append(buildDeleteButton(report.id));
  item.append(buildReportChips(report), meta);
  return item;
}

function buildGroupItem(group: ReportGroup): HTMLLIElement {
  const count = group.reports.length;
  const item = document.createElement("li");
  item.dataset.groupKey = group.key;
  item.dataset.leadId = group.lead.id;
  const resolved = group.pending === 0;
  item.className = resolved
    ? "rounded-xl border border-emerald-200 bg-emerald-50/40 p-3"
    : "rounded-xl border border-slate-200 p-3";

  const head = document.createElement("div");
  head.className = "flex items-start justify-between gap-2";

  const title = document.createElement("p");
  title.className = "text-sm font-semibold text-slate-900";
  title.textContent = group.lead.name;
  head.append(title);

  const badges = document.createElement("div");
  badges.className = "flex shrink-0 gap-1";

  if (count > 1) {
    const badge = document.createElement("span");
    badge.className = "rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700";
    badge.textContent = `${count} reportes`;
    badges.append(badge);
  }

  if (resolved) {
    const badge = document.createElement("span");
    badge.className =
      "rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700";
    badge.textContent = "Cubierto";
    badges.append(badge);
  }

  if (badges.childElementCount > 0) head.append(badges);

  const meta = document.createElement("div");
  meta.className = "mt-2 flex items-center justify-between gap-2";

  const time = document.createElement("span");
  time.className = "text-xs text-slate-400";
  time.textContent = relativeTime(group.latestAt);

  const actions = document.createElement("div");
  actions.className = "flex gap-2";

  const view = document.createElement("button");
  view.type = "button";
  view.className = "text-xs font-medium text-slate-600 transition hover:text-red-600";
  view.textContent = "Ver en el mapa";
  view.addEventListener("click", () => {
    collapseSheet();
    void flyTo(group.lat, group.lng);
  });
  actions.append(view);

  item.append(head, buildGroupChips(group), meta);

  if (count === 1) {
    // sin sublista: la fila del grupo es la del reporte, así deleteReport la anima
    item.dataset.id = group.lead.id;
    if (isMine(group.lead)) actions.append(buildDeleteButton(group.lead.id));
    meta.append(time, actions);
    return item;
  }

  const members = document.createElement("ul");
  members.id = `group-${group.key}`;
  members.className = "mt-2 space-y-2";
  for (const report of group.reports) members.append(buildMemberItem(report));

  const isOpen = expanded.has(group.key);
  members.classList.toggle("hidden", !isOpen);

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "text-xs font-medium text-slate-600 transition hover:text-red-600";
  toggle.setAttribute("aria-controls", members.id);
  const syncToggle = (open: boolean) => {
    toggle.setAttribute("aria-expanded", String(open));
    toggle.textContent = open ? "Ocultar" : `Ver los ${count} reportes`;
  };
  syncToggle(isOpen);

  toggle.addEventListener("click", () => {
    const open = !expanded.has(group.key);
    if (open) expanded.add(group.key);
    else expanded.delete(group.key);
    syncToggle(open);

    if (reduceMotion) {
      members.classList.toggle("hidden", !open);
      return;
    }
    if (open) {
      members.classList.remove("hidden");
      gsap.from(members, { height: 0, opacity: 0, marginTop: 0, duration: 0.3, ease: "power3.out" });
    } else {
      gsap.to(members, {
        height: 0,
        opacity: 0,
        marginTop: 0,
        duration: 0.25,
        onComplete: () => {
          gsap.set(members, { clearProps: "all" });
          members.classList.add("hidden");
        },
      });
    }
  });

  actions.append(toggle);
  meta.append(time, actions);
  item.append(members);
  return item;
}

/** Ids ya dibujados en el mapa. Los reportes ajenos llegan después del boot. */
const drawn = new Set<string>();

/** Reconcilia los marcadores con la lista: agrega, actualiza y quita. */
function syncMarkers(reports: Report[]) {
  const live = new Set<string>();
  for (const report of reports) {
    live.add(report.id);
    if (drawn.has(report.id)) {
      // El popup se enlaza una sola vez en addMarker: sin esto queda viejo.
      updateMarker(report);
    } else {
      addMarker(report);
      drawn.add(report.id);
    }
  }
  for (const id of drawn) {
    if (live.has(id)) continue;
    const marker = removeMarker(id);
    if (marker) detachMarker(marker);
    drawn.delete(id);
  }
}

function renderList(reports: Report[]) {
  const groups = groupReports(reports);
  const keys = new Set(groups.map((g) => g.key));
  for (const key of expanded) if (!keys.has(key)) expanded.delete(key);

  reportList.replaceChildren(...groups.map(buildGroupItem));
  reportCount.textContent = String(reports.length);
  paintEmptyState(reports.length);
  syncMarkers(reports);
}

/* ------------------------------------------------------------------ */
/* Estado de carga y errores                                           */
/* ------------------------------------------------------------------ */

let storeState: StoreState = "loading";
let storeMessage: string | null = null;

// Mientras los reportes vienen en camino no se puede decir «no hay reportes»:
// sería mentira, y sobre una emergencia es una mentira cara.
function paintEmptyState(count: number) {
  if (count > 0 && storeState !== "error") {
    emptyState.classList.add("hidden");
    return;
  }
  emptyState.classList.remove("hidden");
  if (storeState === "error") {
    emptyState.textContent = storeMessage ?? "No se pudieron cargar los reportes.";
    emptyState.className = "mt-3 text-sm text-red-600";
    return;
  }
  emptyState.textContent =
    storeState === "loading" ? "Cargando reportes…" : "Aún no hay reportes.";
  emptyState.className = "mt-3 text-sm text-slate-500";
}

function deleteReport(id: string) {
  const marker = removeMarker(id);
  const item = reportList.querySelector<HTMLLIElement>(`[data-id="${id}"]`);
  const finish = () => {
    if (marker) detachMarker(marker);
    removeReport(id);
  };

  if (reduceMotion || (!marker && !item)) {
    finish();
    return;
  }

  const markerEl = getMarkerElement(id);
  const timeline = gsap.timeline({ onComplete: finish });
  if (markerEl) {
    timeline.to(markerEl, { scale: 0, opacity: 0, duration: 0.3, ease: "back.in(2)" }, 0);
  }
  if (item) {
    timeline.to(item, { opacity: 0, height: 0, margin: 0, padding: 0, duration: 0.3 }, 0);
  }
}

/* ------------------------------------------------------------------ */
/* Submit                                                              */
/* ------------------------------------------------------------------ */

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
    showError(resourcesError, "Selecciona o escribe al menos un recurso.");
    valid = false;
  } else {
    clearError(resourcesError);
  }

  if (!coords) {
    showNote("Falta la ubicación — usa «Ubicar en el mapa» o elige una sugerencia.");
    beginPicking();
    valid = false;
  }

  if (!valid || !coords) return;

  // addReport emite de inmediato, así que renderList ya dibujó el marcador.
  const report = addReport({
    name,
    lat: coords.lat,
    lng: coords.lng,
    resources: [...resources],
  });

  hideSuggestions();
  clearNote();
  stopPicking();
  resetPickButton();

  form.reset();
  resources.clear();
  renderSelectedResources();
  setCoords(null);

  // Bajar el sheet para que se vea aterrizar el marcador nuevo.
  collapseSheet();
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
    const item = reportList.querySelector<HTMLLIElement>(`[data-lead-id="${report.id}"]`);
    if (item) gsap.from(item, { opacity: 0, y: -12, duration: 0.4, ease: "power3.out" });
  }
});

/* ------------------------------------------------------------------ */
/* Centros de acopio                                                   */
/* ------------------------------------------------------------------ */

// Lista curada: llega serializada en el HTML desde la content collection, así
// que acá solo se dibuja y se filtra. No hay manera de agregar uno desde la UI.
const centrosCard = document.getElementById("centros-card");

function initCentros(): void {
  if (!centrosCard) return;

  const toggle = $<HTMLInputElement>("centros-toggle");
  const filterRow = $<HTMLDivElement>("centros-filter");
  const emptyNote = $<HTMLParagraphElement>("centros-empty");
  const chips = [...filterRow.querySelectorAll<HTMLButtonElement>("[data-centro-filter]")];
  let active = "";

  // El aviso solo tiene sentido si la capa está encendida: con el toggle en off
  // no hay centros visibles por decisión de la persona, no por el filtro.
  const reportShown = (shown: number) => {
    emptyNote.classList.toggle("hidden", shown > 0 || !toggle.checked);
  };

  const paintChips = () => {
    for (const chip of chips) {
      const on = (chip.dataset.centroFilter ?? "") === active;
      chip.setAttribute("aria-pressed", String(on));
      chip.className = on ? chipOnClass(chip.dataset.centroFilter || undefined) : CHIP_OFF;
    }
  };

  reportShown(setCentros(loadCentros()));

  filterRow.addEventListener("click", (event) => {
    const chip = (event.target as HTMLElement).closest<HTMLButtonElement>(
      "[data-centro-filter]",
    );
    if (!chip) return;
    active = chip.dataset.centroFilter ?? "";
    paintChips();
    reportShown(setCentroFilter(active || null));
  });

  toggle.addEventListener("change", () => {
    reportShown(setCentrosVisible(toggle.checked));
  });
}

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */

/** Aviso efímero para fallos de escritura — la lista ya volvió a su estado real. */
function showToast(message: string) {
  const toast = document.createElement("p");
  toast.setAttribute("role", "status");
  toast.className =
    "fixed inset-x-4 bottom-4 z-[1100] rounded-lg bg-slate-900 px-4 py-3 text-sm font-medium text-white shadow-lg lg:inset-x-auto lg:left-5 lg:max-w-sm";
  toast.textContent = message;
  document.body.append(toast);
  setTimeout(() => toast.remove(), 5000);
}

initMap("map");
initSheet();
initCentros();

// Se piden ya, no en la primera búsqueda: llegan mientras la persona escribe.
void loadStreets();
void loadAddresses();

onChange(renderList);
onState((state, message) => {
  storeState = state;
  storeMessage = message;
  // Los reportes ajenos cambian quién puede borrar qué: hay que repintar.
  renderList(getReports());
});
onError(showToast);

renderList([]);
void initStore();

renderSelectedResources();
setCoords(null);

if (!reduceMotion) {
  const intro = ["#site-header", "#form-card", "#list-card"];
  if (centrosCard) intro.splice(1, 0, "#centros-card");
  gsap.from(intro, {
    opacity: 0,
    y: 20,
    duration: 0.6,
    stagger: 0.12,
    ease: "power3.out",
  });
}
