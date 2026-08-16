import gsap from "gsap";
import { addReport } from "../data/reports";
import { flyTo, getMarkerElement, isPicking } from "../map";
import { closeReportPanel, closeSheet, isTabVisible, onTabChange, openReportPanel } from "../sheet";
import { isValidPhone } from "../ui/contact";
import { $, clearError, showError } from "../ui/dom";
import { flashField } from "../ui/flash";
import { createLocationPicker } from "./location-picker";
import { currentReportTab, onReportTabChange, showReportTab } from "./report-tabs";
import { createResourcePicker } from "./resource-picker";

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** La mitad del formulario que una zona ya reportada sabe contestar. */
export type ReportPrefill = {
  name: string;
  placeName: string | null;
  lat: number;
  lng: number;
};

/**
 * El formulario guarda sus campos en el cierre de `initReportForm`, así que
 * llenarlo desde afuera pasa por acá. Antes de arrancar no hay a quién
 * llamarle: `app.ts` inicializa el formulario antes que el historial, y aun así
 * un `null` es más barato que un error para algo que nadie pudo haber tocado
 * todavía.
 */
let applyPrefill: ((zone: ReportPrefill) => void) | null = null;

export function prefillReport(zone: ReportPrefill): void {
  applyPrefill?.(zone);
}

export function initReportForm(): void {
  const form = $<HTMLFormElement>("report-form");
  const urgente = $<HTMLInputElement>("urgente");
  const placeName = $<HTMLInputElement>("place-name");
  const note = $<HTMLTextAreaElement>("note");
  const noteCount = $<HTMLSpanElement>("note-count");
  const contactName = $<HTMLInputElement>("contact-name");
  const contactPhone = $<HTMLInputElement>("contact-phone");
  const contactError = $<HTMLParagraphElement>("contact-error");

  // Dirección, sugerencias y pin arrastrable: los comparte con el formulario de
  // acopios, así que el prefijo de los ids es lo único propio. El catálogo de
  // insumos va igual — acá se pregunta qué falta y allá qué reciben, pero se
  // nombra la misma cosa.
  const location = createLocationPicker("report");
  // Veinte es el `check` de `reports.resources`.
  const picker = createResourcePicker("report", { max: 20 });

  // El `maxlength` corta en 200 sin avisar: el contador es lo único que dice
  // cuánto queda antes de que el navegador empiece a tragarse las teclas.
  function syncNoteCount() {
    noteCount.textContent = String(note.value.length);
  }
  note.addEventListener("input", syncNoteCount);

  // `form.reset()` solo devuelve los controles nativos a su valor inicial: el
  // pin, las sugerencias y los insumos elegidos viven fuera del formulario y
  // hay que limpiarlos aparte.
  function resetForm() {
    form.reset();
    picker.clear();
    location.reset();
    clearError(contactError);
    syncNoteCount();
  }

  /* ---------------------------------------------------------------- */
  /* Rellenar desde una zona ya reportada                              */
  /* ---------------------------------------------------------------- */

  // Se copia la ubicación y nada más. Los insumos, la nota y el contacto son
  // justamente lo que cambió desde la última vez: heredarlos publicaría como
  // nuevo un dato que nadie volvió a mirar.
  applyPrefill = (zone) => {
    resetForm();
    placeName.value = zone.placeName ?? "";
    location.setLocation(zone.name, { lat: zone.lat, lng: zone.lng }, "zona ya reportada");
    showReportTab("necesidad");
    openReportPanel();
    location.flash();
    flashField(placeName);
  };

  /* ---------------------------------------------------------------- */
  /* Envío                                                             */
  /* ---------------------------------------------------------------- */

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    let valid = true;

    const name = location.getName();
    if (!name) {
      location.showNameError("Escribe la dirección.");
      valid = false;
    } else {
      location.clearNameError();
    }

    // Sin insumos también se reporta: la dirección es lo único obligatorio. Un
    // punto en el mapa que solo dice «acá pasa algo» vale más que el reporte que
    // nunca se envió porque había que abrir categorías primero — lo que falta lo
    // agrega cualquiera después.
    const resources = picker.values();
    picker.clearError();

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
      placeName: placeName.value.trim() || null,
      lat: coords.lat,
      lng: coords.lng,
      resources,
      status: urgente.checked ? "urgente" : "activo",
      note: note.value.trim() || null,
      contactName: person || null,
      contactPhone: person && phone ? phone : null,
    });

    resetForm();

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
  // Closing the form empties it: what was typed for one place is not what the
  // next report is about, and a half-filled form reopened hours later publishes
  // stale data with no warning. The draft pin goes with it — a provisional mark
  // on the map with no form behind it is one nobody can move or submit. How it
  // was closed does not matter: the ✕, the scrim, the drag, Escape or switching
  // panel. What counts is that it is no longer on screen.
  //
  // Picking on the map is the exception, hence `isPicking()`: the sheet closes
  // on purpose there to let the map be touched, and the form stays alive behind
  // it waiting for the point.
  const onScreen = () => isTabVisible("reportar") || isPicking();
  let wasOnScreen = onScreen();
  onTabChange(() => {
    const visible = isTabVisible("reportar");
    if (visible && !wasVisible) picker.collapse();
    wasVisible = visible;

    const shown = onScreen();
    if (shown === wasOnScreen) return;
    wasOnScreen = shown;
    if (!shown) {
      resetForm();
      location.suspend();
    } else if (currentReportTab() === "necesidad") location.resume();
  });

  // El pin y el modo de señalar son únicos en el mapa: solo puede tenerlos la
  // pestaña que se está viendo.
  onReportTabChange((tab) => {
    if (tab === "necesidad") location.resume();
    else location.suspend();
  });
}
