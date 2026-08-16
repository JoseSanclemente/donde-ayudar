import { addCenter } from "../data/centers";
import { flyTo, isPicking } from "../map";
import {
  closeReportPanel,
  closeSheet,
  isTabVisible,
  onTabChange,
  openReportPanel,
} from "../sheet";
import { instagramHandle, isValidInstagram, isValidPhone } from "../ui/contact";
import { $, clearError, showError } from "../ui/dom";
import { flashField } from "../ui/flash";
import { createLocationPicker } from "./location-picker";
import { currentReportTab, onReportTabChange, showReportTab } from "./report-tabs";
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

  // Supply names from the `resources.ts` catalog, which is what the `donations`
  // column stores — the same ones a report asks for, so what is missing and
  // what is there compare without translating anything. Eighty is the CHECK of
  // `centers.donations`.
  const picker = createResourcePicker("center", { max: 80 });

  // `form.reset()` only returns the native controls to their initial value: the
  // pin, the suggestions and the chosen supplies live outside the form.
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
    location.setLocation(point.address, { lat: point.lat, lng: point.lng }, "punto ya registrado");
    // The tab change is what hands the draft pin over from the other form.
    showReportTab("acopio");
    openReportPanel();
    location.flash();
    flashField(pointName);
  };

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    let valid = true;

    // A mirror of the table's CHECKs: same lengths and the same phone pattern.
    // Without this the rejection comes back as a generic "could not register"
    // that does not say which field was wrong.
    const name = pointName.value.trim();
    if (name.length < 3) {
      showError(pointNameError, "Escribe el nombre del punto — al menos 3 letras.");
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

    // No minimum: a point that has not decided what it needs is still a point
    // worth having on the map.
    const donations = picker.values();
    picker.clearError();

    const phone = whatsapp.value.trim();
    if (phone && !isValidPhone(phone)) {
      showError(whatsappError, "Revisa el número: solo números, espacios, + ( ) y guiones.");
      valid = false;
    } else {
      clearError(whatsappError);
    }

    const handle = instagram.value.trim();
    if (handle && !isValidInstagram(handle)) {
      showError(instagramError, "Revisa el usuario: solo letras, números, punto y guion bajo.");
      valid = false;
    } else {
      clearError(instagramError);
    }

    const coords = location.requireCoords();
    if (!coords) valid = false;

    if (!valid || !coords) return;

    // addCenter emits right away: the marker is already on the map by the time
    // the sheet finishes closing.
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

  // The draft pin and the click-to-pick mode are single on the map: only the
  // tab on screen can hold them.
  onReportTabChange((tab) => {
    if (tab === "acopio") {
      location.resume();
      // Whoever opens the form looks for the address first, and seven expanded
      // categories push everything else off the screen.
      picker.collapse();
    } else {
      location.suspend();
    }
  });

  // Closing the form empties it: what was typed for one point is not what the
  // next one is about, and a half-filled form reopened hours later publishes
  // stale data with no warning. The draft pin goes with it — a mark on the map
  // with no form behind it is one nobody can move or submit. How it went away
  // does not matter.
  //
  // Picking on the map is the exception, hence `isPicking()`: the sheet closes
  // on purpose there to let the map be touched, and the form stays alive behind
  // it waiting for the point.
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
