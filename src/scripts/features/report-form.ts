import gsap from "gsap";
import { addReport } from "../data/reports";
import { flyTo, getMarkerElement, isPicking } from "../map";
import {
  closeReportPanel,
  closeSheet,
  isTabVisible,
  onTabChange,
  openReportPanel,
} from "../sheet";
import { isValidPhone } from "@/lib/contact";
import { $, clearError, showError } from "../ui/dom";
import { flashField } from "../ui/flash";
import { createLocationPicker } from "./location-picker";
import {
  currentReportTab,
  onReportTabChange,
  showReportTab,
} from "./report-tabs";
import { createResourcePicker } from "./resource-picker";

const reduceMotion = window.matchMedia(
  "(prefers-reduced-motion: reduce)",
).matches;

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

  const location = createLocationPicker("report");

  const picker = createResourcePicker("report", { max: 20 });

  function syncNoteCount() {
    noteCount.textContent = String(note.value.length);
  }
  note.addEventListener("input", syncNoteCount);

  function resetForm() {
    form.reset();
    picker.clear();
    location.reset();
    clearError(contactError);
    syncNoteCount();
  }

  applyPrefill = (zone) => {
    resetForm();
    placeName.value = zone.placeName ?? "";
    location.setLocation(
      zone.name,
      { lat: zone.lat, lng: zone.lng },
      "zona ya reportada",
    );
    showReportTab("necesidad");
    openReportPanel();
    location.flash();
    flashField(placeName);
  };

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

    const resources = picker.values();
    picker.clearError();

    const person = contactName.value.trim();
    const phone = contactPhone.value.trim();
    if (phone && !person) {
      showError(
        contactError,
        "Escribe también un nombre: un número solo no dice por quién preguntar.",
      );
      valid = false;
    } else if (person && person.length < 2) {
      showError(contactError, "El nombre del contacto es muy corto.");
      valid = false;
    } else if (phone && !isValidPhone(phone)) {
      showError(
        contactError,
        "Revisa el teléfono: solo números, espacios, + ( ) y guiones.",
      );
      valid = false;
    } else {
      clearError(contactError);
    }

    const coords = location.requireCoords();
    if (!coords) valid = false;

    if (!valid || !coords) return;

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
      const item = document.querySelector<HTMLLIElement>(
        `[data-lead-id="${report.id}"]`,
      );
      if (item)
        gsap.from(item, {
          opacity: 0,
          y: -12,
          duration: 0.4,
          ease: "power3.out",
        });
    }
  });

  let wasVisible = isTabVisible("reportar");

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

  onReportTabChange((tab) => {
    if (tab === "necesidad") location.resume();
    else location.suspend();
  });
}
