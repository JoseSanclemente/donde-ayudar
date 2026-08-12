import { addCentro } from "../data/centros";
import { flyTo, isPicking } from "../map";
import { closeReportPanel, closeSheet, isTabVisible, onTabChange } from "../sheet";
import { isValidPhone } from "../ui/contact";
import { $, clearError, showError } from "../ui/dom";
import { createLocationPicker } from "./location-picker";
import { currentReportTab, onReportTabChange } from "./report-tabs";
import { createResourcePicker } from "./resource-picker";

export function initCentroForm(): void {
  const form = $<HTMLFormElement>("centro-form");
  const nombre = $<HTMLInputElement>("centro-nombre");
  const nombreError = $<HTMLParagraphElement>("centro-nombre-error");
  const horario = $<HTMLInputElement>("centro-horario");
  const telefono = $<HTMLInputElement>("centro-telefono");
  const telefonoError = $<HTMLParagraphElement>("centro-telefono-error");
  const notas = $<HTMLTextAreaElement>("centro-notas");

  const location = createLocationPicker("centro");

  // Nombres de insumo del catálogo de `resources.ts`, que es lo que guarda la
  // columna `recibe` — los mismos que pide un reporte, para que lo que falta y
  // lo que hay se puedan comparar sin traducir nada.
  const picker = createResourcePicker("centro");

  /* ---------------------------------------------------------------- */
  /* Envío                                                             */
  /* ---------------------------------------------------------------- */

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    let valid = true;

    // Espejo de los CHECK de la tabla: mismos largos y el mismo patrón de
    // teléfono. Sin esto, el rechazo vuelve como un «no se pudo registrar» que
    // no dice cuál de los campos estuvo mal.
    const name = nombre.value.trim();
    if (name.length < 3) {
      showError(nombreError, "Escribe el nombre del punto — al menos 3 letras.");
      valid = false;
    } else {
      clearError(nombreError);
    }

    const direccion = location.getName();
    if (direccion.length < 3) {
      location.showNameError("Escribe la dirección del punto.");
      valid = false;
    } else {
      location.clearNameError();
    }

    const recibe = picker.values();
    if (recibe.length === 0) {
      picker.showError("Marca al menos un insumo de los que están recibiendo.");
      valid = false;
    } else {
      picker.clearError();
    }

    const phone = telefono.value.trim();
    if (phone && !isValidPhone(phone)) {
      showError(telefonoError, "Revisa el teléfono: solo números, espacios, + ( ) y guiones.");
      valid = false;
    } else {
      clearError(telefonoError);
    }

    const coords = location.requireCoords();
    if (!coords) valid = false;

    if (!valid || !coords) return;

    // addCentro emite de inmediato: el marcador ya está en el mapa cuando el
    // sheet termina de cerrarse.
    const centro = addCentro({
      name,
      direccion,
      lat: coords.lat,
      lng: coords.lng,
      horario: horario.value.trim(),
      telefono: phone || null,
      notas: notas.value.trim() || null,
      recibe,
    });

    form.reset();
    picker.clear();
    picker.collapse();
    location.reset();
    clearError(nombreError);
    clearError(telefonoError);

    closeReportPanel();
    closeSheet();
    await flyTo(centro.lat, centro.lng, 17);
  });

  // El pin y el modo de señalar son únicos en el mapa: solo puede tenerlos la
  // pestaña que se está viendo.
  onReportTabChange((tab) => {
    if (tab === "acopio") {
      location.resume();
      // Quien abre el formulario busca la dirección primero, y siete categorías
      // desplegadas empujan todo lo demás fuera de la pantalla.
      picker.collapse();
    } else {
      location.suspend();
    }
  });

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
    const shown = onScreen();
    if (shown === wasOnScreen) return;
    wasOnScreen = shown;
    if (!shown) location.suspend();
    else if (currentReportTab() === "acopio") location.resume();
  });

  if (currentReportTab() !== "acopio") location.suspend();
}
