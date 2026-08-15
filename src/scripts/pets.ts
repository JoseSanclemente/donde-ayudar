import { initPetsData } from "./data/boot-pets";
import { onError } from "./data/errors";
import { initPetsGrid } from "./features/pets-grid";
import { initPetSheet } from "./pet-sheet";
import { startTimeTicker } from "./ui/time";
import { showToast } from "./ui/toast";

/**
 * El arranque de `/mascotas`, el gemelo de `app.ts` para la otra página. Nada
 * de acá toca el mapa, así que Leaflet, la malla vial y los otros cinco stores
 * no entran a este bundle.
 */

initPetSheet();
initPetsGrid();

// «Encontrada hace 2 minutos» congelado media hora miente sobre el dato.
startTimeTicker();

onError(showToast);

void initPetsData();
