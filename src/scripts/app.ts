import { initData } from "./data/boot";
import { onError } from "./data/errors";
import { initAlertBanner } from "./features/alert-banner";
import { initCentersLayer } from "./features/centers-layer";
import { initHeaderOffset } from "./features/header-offset";
import { initMarkerActions } from "./features/marker-actions";
import { initMarkerSheet } from "./features/marker-sheet";
import { initOffersPanel } from "./features/offers-panel";
import { initCenterForm } from "./features/center-form";
import { initReportForm } from "./features/report-form";
import { initReportList } from "./features/report-list";
import { initReportTabs } from "./features/report-tabs";
import { initShare } from "./features/share";
import { initSyncBadge } from "./features/sync-badge";
import { initUpdatesFeed } from "./features/updates-feed";
import { initUserLocation } from "./features/user-location";
import { loadAddresses } from "./geo-index";
import { initMap } from "./map";
import { initSheet } from "./sheet";
import { startTimeTicker } from "./ui/time";
import { showToast } from "./ui/toast";

initMap("map");
// Justo detrás del mapa: el permiso se pide cuanto antes y nadie lo espera.
initUserLocation();
initSheet();
initMarkerSheet();
initMarkerActions();
initShare();
initCentersLayer();
// Antes del aviso: la primera vez que aparece ya cambia la altura del header.
initHeaderOffset();
initAlertBanner();
// Antes de los dos formularios: los dos se suscriben a su cambio de pestaña.
initReportTabs();
initReportForm();
initCenterForm();
initReportList();
initUpdatesFeed();
initOffersPanel();
initSyncBadge();

// «Hace 2 minutos» congelado media hora miente sobre la frescura del dato.
startTimeTicker();

// El índice de direcciones se pide ya: son 56 KB y llegan mientras la persona
// escribe. La malla vial son dos megas —medio mega comprimido, más un `JSON.parse`
// y una reproyección entera en el hilo principal— y acá no se pide: la trae
// `location-picker` al primer foco del campo de dirección, que es cuando hace
// falta. Se calentaba desde acá para el que nunca abre el formulario, y eso es
// justo al revés: la mayoría de las visitas nunca lo abren y estaban pagando el
// archivo completo.
void loadAddresses();

onError(showToast);

void initData();
