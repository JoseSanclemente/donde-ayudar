import { addCenter } from "../data/centers";
import { flyTo, isPicking } from "../map";
import { closeReportPanel, closeSheet, isTabVisible, onTabChange } from "../sheet";
import { instagramHandle, isValidInstagram, isValidPhone } from "../ui/contact";
import { $, clearError, showError } from "../ui/dom";
import { createLocationPicker } from "./location-picker";
import { currentReportTab, onReportTabChange } from "./report-tabs";
import { createResourcePicker } from "./resource-picker";

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

    form.reset();
    picker.clear();
    picker.collapse();
    location.reset();
    clearError(pointNameError);
    clearError(whatsappError);
    clearError(instagramError);

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

  // Losing sight of the form takes the pin with it: a draft point on the map
  // with no form behind it is a mark nobody can move or submit. How it went
  // away does not matter. The coordinates are not lost: coming back puts the
  // pin where it was.
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
    if (!shown) location.suspend();
    else if (currentReportTab() === "acopio") location.resume();
  });

  if (currentReportTab() !== "acopio") location.suspend();
}
