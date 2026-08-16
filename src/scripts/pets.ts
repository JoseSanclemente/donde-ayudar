import { initPetsData } from "./data/boot-pets";
import { onError } from "./data/errors";
import { getPetsState, onPetsState } from "./data/pets";
import { initPetsFilter } from "./features/pets-filter";
import { initPetsGrid, PET_PARAM, type PetsGrid } from "./features/pets-grid";
import { initPetSheet } from "./pet-sheet";
import { startTimeTicker } from "./ui/time";
import { showToast } from "./ui/toast";

/**
 * El arranque de `/mascotas`, el gemelo de `app.ts` para la otra página. Nada
 * de acá toca el mapa, así que Leaflet, la malla vial y los otros cinco stores
 * no entran a este bundle.
 */

initPetSheet();
// El filtro y la cuadrícula no se importan entre sí: los ata el arranque, que es
// para lo que está. La cuadrícula va primero porque el filtro empuja sus valores
// por defecto apenas se monta.
const grid = initPetsGrid();
initPetsFilter(grid.setFilter);
openPetFromUrl(grid);

// «Encontrada hace 2 minutos» congelado media hora miente sobre el dato.
startTimeTicker();

onError(showToast);

void initPetsData();

/**
 * Quien llega desde el WhatsApp de una tanda trae en la dirección el código de
 * la mascota por la que escribe (`/mascotas?mascota=ROYI-00012`). Como el filtro
 * con `lugar`: se lee al arrancar y solo se atiende cuando el store dice
 * `ready` —antes no hay a quién buscar—, y se borra de la barra con
 * `replaceState`, porque llegar desde un mensaje no es una página que alguien
 * navegó. La cuadrícula y el filtro no se conocen entre sí; atarlos es el
 * trabajo del arranque.
 */
function openPetFromUrl(pets: PetsGrid): void {
  const code = new URLSearchParams(location.search).get(PET_PARAM)?.trim();
  if (!code) return;

  const open = () => {
    const url = new URL(location.href);
    url.searchParams.delete(PET_PARAM);
    history.replaceState(history.state, "", url);
    pets.focusPet(code);
  };

  if (getPetsState().state === "ready") {
    open();
    return;
  }
  const stop = onPetsState((state) => {
    if (state !== "ready") return;
    stop();
    open();
  });
}
