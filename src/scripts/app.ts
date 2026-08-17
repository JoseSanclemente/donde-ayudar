import { initData } from "./data/boot";
import { onError } from "./data/errors";
import { initAffectedLayer } from "./features/affected-layer";
import { initAlertBanner } from "./features/alert-banner";
import { initCentersLayer } from "./features/centers-layer";
import { initMapFilter } from "./features/map-filter";
import { initHeaderOffset } from "./features/header-offset";
import { initMarkerActions } from "./features/marker-actions";
import { initMarkerSheet } from "./features/marker-sheet";
import { initVolunteerPanel } from "./features/volunteer-panel";
import { initOffersPanel } from "./features/offers-panel";
import { initCenterForm } from "./features/center-form";
import { initCenterHistory } from "./features/center-history";
import { initReportForm } from "./features/report-form";
import { initReportHistory } from "./features/report-history";
import { initReportList } from "./features/report-list";
import { initReportTabs } from "./features/report-tabs";
import { initShare } from "./features/share";
import { initSyncBadge } from "./features/sync-badge";
import { initUpdatesFeed } from "./features/updates-feed";
import { initUserLocation } from "./features/user-location";
import { initEmergencyStats } from "./features/emergency-stats";
import { initEmergencyView } from "./features/emergency-view";
import { loadAddresses } from "./geo-index";
import { initMap } from "./map";
import { initSheet } from "./sheet";
import { startTimeTicker } from "./ui/time";
import { showToast } from "./ui/toast";

initMap("map");

const stats = initEmergencyStats();

initUserLocation(stats.hide);

initEmergencyView(stats);
initSheet();
initMarkerSheet();
initMarkerActions();
initShare();
initCentersLayer();

initAffectedLayer();

initMapFilter();

initHeaderOffset();
initAlertBanner();

initReportTabs();
initReportForm();

initReportHistory();
initCenterForm();

initCenterHistory();
initReportList();
initUpdatesFeed();
initOffersPanel();
initVolunteerPanel();
initSyncBadge();

startTimeTicker();

void loadAddresses();

onError(showToast);

void initData();
