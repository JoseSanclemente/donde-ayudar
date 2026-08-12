import gsap from "gsap";
import { initData } from "./data/boot";
import { onError } from "./data/errors";
import { initAlertBanner } from "./features/alert-banner";
import { initCentrosLayer } from "./features/centros-layer";
import { initHeaderOffset } from "./features/header-offset";
import { initMarkerActions } from "./features/marker-actions";
import { initMarkerSheet } from "./features/marker-sheet";
import { initOffersPanel } from "./features/offers-panel";
import { initCentroForm } from "./features/centro-form";
import { initReportForm } from "./features/report-form";
import { initReportList } from "./features/report-list";
import { initReportTabs } from "./features/report-tabs";
import { initShare } from "./features/share";
import { initSyncBadge } from "./features/sync-badge";
import { initUpdatesFeed } from "./features/updates-feed";
import { initUserLocation } from "./features/user-location";
import { loadAddresses, loadStreets } from "./geo-index";
import { initMap } from "./map";
import { initSheet } from "./sheet";
import { startTimeTicker } from "./ui/time";
import { showToast } from "./ui/toast";

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

initMap("map");
// Justo detrás del mapa: el permiso se pide cuanto antes y nadie lo espera.
initUserLocation();
initSheet();
initMarkerSheet();
initMarkerActions();
initShare();
initCentrosLayer();
// Antes del aviso: la primera vez que aparece ya cambia la altura del header.
initHeaderOffset();
initAlertBanner();
// Antes de los dos formularios: los dos se suscriben a su cambio de pestaña.
initReportTabs();
initReportForm();
initCentroForm();
initReportList();
initUpdatesFeed();
initOffersPanel();
initSyncBadge();

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
  gsap.from(["#site-header", "#list-card"], {
    opacity: 0,
    y: 20,
    duration: 0.6,
    stagger: 0.12,
    ease: "power3.out",
  });
}
