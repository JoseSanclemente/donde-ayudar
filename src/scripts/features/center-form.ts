import { addCenter } from "../data/centers";
import { flyTo, isPicking } from "../map";
import {
  closeReportPanel,
  closeSheet,
  isTabVisible,
  onTabChange,
  openReportPanel,
} from "../sheet";
import { instagramHandle, isValidInstagram, isValidPhone } from "@/lib/contact";
import { $, clearError, showError } from "../ui/dom";
import { flashField } from "../ui/flash";
import { createLocationPicker } from "./location-picker";
import {
  currentReportTab,
  onReportTabChange,
  showReportTab,
} from "./report-tabs";
import { createResourcePicker } from "./resource-picker";

/**
 * A point that was already published once, offered back by the history above the
 * form. Everything is copied, unlike a need: what a warehouse takes and who
 * answers the phone there is the same the next morning — what expired is the
 * confirmation, not the data.
 */
export type CenterPrefill = {
  name: string;
  address: string;
  lat: number;
  lng: number;
  hours: string;
  donations: string[];
  contactWhatsapp?: string;
  contactInstagram?: string;
  notes?: string;
};

/**
 * The form keeps its fields in the closure of `initCenterForm`, so filling it
 * from outside goes through here — the same door `prefillReport` opens for the
 * need form. Before boot there is nobody to call: `app.ts` initializes the form
 * before the history.
 */
let applyPrefill: ((point: CenterPrefill) => void) | null = null;

export function prefillCenter(point: CenterPrefill): void {
  applyPrefill?.(point);
}

export function initCenterForm(): void {
  const form = $<HTMLFormElement>("center-form");
  const pointName = $<HTMLInputElement>("center-point-name");
  const pointNameError = $<HTMLParagraphElement>("center-point-name-error");
  const hours = $<HTMLInputElement>("center-hours");
  const whatsapp = $<HTMLInputElement>("center-whatsapp");
  const whatsappError = $<HTMLParagraphElement>("center-whatsapp-error");
  const instagram = $<HTMLInputElement>("center-instagram");
  const instagramError = $<HTMLParagraphElement>("center-instagram-error");
  const notes = $<HTMLTextAreaElement>("center-notes");

  const location = createLocationPicker("center");

  const picker = createResourcePicker("center", { max: 80 });

  function resetForm() {
    form.reset();
    picker.clear();
    location.reset();
    clearError(pointNameError);
    clearError(whatsappError);
    clearError(instagramError);
  }

  applyPrefill = (point) => {
    resetForm();
    pointName.value = point.name;
    hours.value = point.hours;
    whatsapp.value = point.contactWhatsapp ?? "";
    instagram.value = point.contactInstagram ?? "";
    notes.value = point.notes ?? "";
    picker.setValues(point.donations);
    location.setLocation(
      point.address,
      { lat: point.lat, lng: point.lng },
      "punto ya registrado",
    );

    showReportTab("acopio");
    openReportPanel();
    location.flash();
    flashField(pointName);
  };

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    let valid = true;

    const name = pointName.value.trim();
    if (name.length < 3) {
      showError(
        pointNameError,
        "Escribe el nombre del punto — al menos 3 letras.",
      );
      valid = false;
    } else {
      clearError(pointNameError);
    }

    const address = location.getName();
    if (address.length < 3) {
      location.showNameError("Escribe la dirección del punto.");
      valid = false;
    } else {
      location.clearNameError();
    }

    const donations = picker.values();
    picker.clearError();

    const phone = whatsapp.value.trim();
    if (phone && !isValidPhone(phone)) {
      showError(
        whatsappError,
        "Revisa el número: solo números, espacios, + ( ) y guiones.",
      );
      valid = false;
    } else {
      clearError(whatsappError);
    }

    const handle = instagram.value.trim();
    if (handle && !isValidInstagram(handle)) {
      showError(
        instagramError,
        "Revisa el usuario: solo letras, números, punto y guion bajo.",
      );
      valid = false;
    } else {
      clearError(instagramError);
    }

    const coords = location.requireCoords();
    if (!coords) valid = false;

    if (!valid || !coords) return;

    const center = addCenter({
      name,
      address,
      lat: coords.lat,
      lng: coords.lng,
      hours: hours.value.trim(),
      contactWhatsapp: phone || null,
      contactInstagram: handle ? instagramHandle(handle) : null,
      notes: notes.value.trim() || null,
      donations,
    });

    resetForm();
    picker.collapse();

    closeReportPanel();
    closeSheet();
    await flyTo(center.lat, center.lng, 17);
  });

  onReportTabChange((tab) => {
    if (tab === "acopio") {
      location.resume();

      picker.collapse();
    } else {
      location.suspend();
    }
  });

  const onScreen = () => isTabVisible("reportar") || isPicking();
  let wasOnScreen = onScreen();
  onTabChange(() => {
    const shown = onScreen();
    if (shown === wasOnScreen) return;
    wasOnScreen = shown;
    if (!shown) {
      resetForm();
      location.suspend();
    } else if (currentReportTab() === "acopio") location.resume();
  });

  if (currentReportTab() !== "acopio") location.suspend();
}
