import gsap from "gsap";
import { addReport } from "../data/reports";
import { flyTo, getMarkerElement, isPicking } from "../map";
import { closeReportPanel, closeSheet, isTabVisible, onTabChange } from "../sheet";
import { isValidPhone } from "../ui/contact";
import { $, clearError, showError } from "../ui/dom";
import { createLocationPicker } from "./location-picker";
import { currentReportTab, onReportTabChange } from "./report-tabs";
import { createResourcePicker } from "./resource-picker";

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function initReportForm(): void {
  const form = $<HTMLFormElement>("report-form");
  const urgente = $<HTMLInputElement>("urgente");
  const note = $<HTMLTextAreaElement>("note");
  const contactName = $<HTMLInputElement>("contact-name");
  const contactPhone = $<HTMLInputElement>("contact-phone");
  const contactError = $<HTMLParagraphElement>("contact-error");

  // Dirección, sugerencias y pin arrastrable: los comparte con el formulario de
  // acopios, así que el prefijo de los ids es lo único propio. El catálogo de
  // insumos va igual — acá se pregunta qué falta y allá qué reciben, pero se
  // nombra la misma cosa.
  const location = createLocationPicker("report");
  const picker = createResourcePicker("report");

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

    const resources = picker.values();
    if (resources.length === 0) {
      picker.showError("Selecciona al menos un recurso.");
      valid = false;
    } else {
      picker.clearError();
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
      resources,
      status: urgente.checked ? "urgente" : "activo",
      note: note.value.trim() || null,
      contactName: person || null,
      contactPhone: person && phone ? phone : null,
    });

    form.reset();
    picker.clear();
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
  // Perder de vista el formulario se lleva el pin: un punto provisional en el
  // mapa sin el formulario detrás no es más que una marca que nadie puede ni
  // mover ni enviar. Da igual por dónde se fue —la ✕, el scrim, el arrastre,
  // Escape o cambiar de panel—: lo que cuenta es que ya no se ve. Las
  // coordenadas no se pierden: volver repone el pin donde estaba.
  //
  // Señalar en el mapa es la excepción y por eso el `isPicking()`: ahí el sheet
  // se cierra a propósito para dejar tocar el mapa, y el formulario sigue vivo
  // detrás esperando el punto.
  const onScreen = () => isTabVisible("reportar") || isPicking();
  let wasOnScreen = onScreen();
  onTabChange(() => {
    const visible = isTabVisible("reportar");
    if (visible && !wasVisible) picker.collapse();
    wasVisible = visible;

    const shown = onScreen();
    if (shown === wasOnScreen) return;
    wasOnScreen = shown;
    if (!shown) location.suspend();
    else if (currentReportTab() === "necesidad") location.resume();
  });

  // El pin y el modo de señalar son únicos en el mapa: solo puede tenerlos la
  // pestaña que se está viendo.
  onReportTabChange((tab) => {
    if (tab === "necesidad") location.resume();
    else location.suspend();
  });
}
