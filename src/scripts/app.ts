import gsap from "gsap";
import { initData } from "./data/boot";
import { onError } from "./data/errors";
import { initAlertBanner } from "./features/alert-banner";
import { initCentrosPanel } from "./features/centros-panel";
import { initMarkerSheet } from "./features/marker-sheet";
import { initOffersPanel } from "./features/offers-panel";
import { initReportForm } from "./features/report-form";
import { initReportList } from "./features/report-list";
import { initUpdatesFeed } from "./features/updates-feed";
import { loadAddresses, loadStreets } from "./geo-index";
import { initMap } from "./map";
import { initSheet } from "./sheet";
import { maybe$ } from "./ui/dom";
import { startTimeTicker } from "./ui/time";
import { showToast } from "./ui/toast";

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

initMap("map");
initSheet();
initMarkerSheet();
initCentrosPanel();
initAlertBanner();
initReportForm();
initReportList();
initUpdatesFeed();
initOffersPanel();

// «Hace 2 minutos» congelado media hora miente sobre la frescura del dato.
startTimeTicker();

// Se piden ya, no en la primera búsqueda: llegan mientras la persona escribe.
void loadStreets();
void loadAddresses();

onError(showToast);

void initData();

if (!reduceMotion) {
  // `#form-card` arranca oculto detrás del FAB: animarlo dejaría un hueco. El FAB
  // se queda fuera de la entrada a propósito: es el único acceso al formulario y
  // no puede depender de que una animación termine bien para existir.
  const intro = ["#site-header", "#list-card"];
  if (maybe$("centros-card")) intro.splice(1, 0, "#centros-card");
  gsap.from(intro, {
    opacity: 0,
    y: 20,
    duration: 0.6,
    stagger: 0.12,
    ease: "power3.out",
  });
}
