import gsap from "gsap";
import { addCentro } from "../data/centros";
import { flyTo } from "../map";
import { CHIP_OFF, chipOnClass } from "../resources";
import { closeReportPanel, closeSheet } from "../sheet";
import { isValidPhone } from "../ui/contact";
import { $, clearError, showError } from "../ui/dom";
import { createLocationPicker } from "./location-picker";
import { currentReportTab, onReportTabChange } from "./report-tabs";

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function initCentroForm(): void {
  const form = $<HTMLFormElement>("centro-form");
  const nombre = $<HTMLInputElement>("centro-nombre");
  const nombreError = $<HTMLParagraphElement>("centro-nombre-error");
  const horario = $<HTMLInputElement>("centro-horario");
  const recibeChips = $<HTMLDivElement>("centro-recibe");
  const recibeError = $<HTMLParagraphElement>("centro-recibe-error");
  const telefono = $<HTMLInputElement>("centro-telefono");
  const telefonoError = $<HTMLParagraphElement>("centro-telefono-error");
  const notas = $<HTMLTextAreaElement>("centro-notas");

  const location = createLocationPicker("centro");

  // Ids de categoría de `resources.ts`, que es lo que guarda la columna `recibe`
  // y lo que valida el CHECK `centros_recibe_ids`.
  const recibe = new Set<string>();

  // Igual que en el formulario de necesidades: el formulario no se destruye al
  // cerrarlo, así que las categorías conservan lo que se dejó abierto la vez
  // pasada. Plegarlas no pierde nada — lo marcado sigue en `recibe` y el chip
  // del encabezado lo dice sin desplegar.
  function collapseCategories() {
    recibeChips.querySelectorAll("details").forEach((panel) => {
      panel.open = false;
    });
  }

  function syncChips() {
    recibeChips.querySelectorAll<HTMLButtonElement>("[data-recibe]").forEach((chip) => {
      const id = chip.dataset.recibe as string;
      const active = recibe.has(id);
      chip.className = active ? chipOnClass(id) : CHIP_OFF;
      chip.setAttribute("aria-pressed", String(active));
      // El panel plegado esconde el detalle, así que la categoría marcada tiene
      // que leerse en el encabezado.
      chip.textContent = active ? "✓ Recibe" : "Recibir";
    });
    if (recibe.size > 0) clearError(recibeError);
  }

  recibeChips.addEventListener("click", (event) => {
    const chip = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-recibe]");
    if (!chip) return;
    // The button lives inside the `<summary>`, and opening the `<details>` is the
    // default action of any click in there. Marking a category is not asking to
    // see what is inside it.
    event.preventDefault();
    const id = chip.dataset.recibe as string;
    if (recibe.has(id)) recibe.delete(id);
    else recibe.add(id);
    syncChips();
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

    if (recibe.size === 0) {
      showError(recibeError, "Marca al menos una categoría de lo que recibe.");
      valid = false;
    } else {
      clearError(recibeError);
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
      recibe: [...recibe],
    });

    form.reset();
    recibe.clear();
    syncChips();
    collapseCategories();
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
      collapseCategories();
    } else {
      location.suspend();
    }
  });

  syncChips();
  collapseCategories();
  if (currentReportTab() !== "acopio") location.suspend();
}
