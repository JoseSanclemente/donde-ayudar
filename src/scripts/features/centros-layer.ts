import { getCentros, onCentros } from "../data/centros";
import { isMine } from "../data/session";
import { setCentros } from "../map";
import type { Centro } from "../centros";

/**
 * La capa de puntos de donación: este archivo solo la dibuja.
 *
 * Se suscribe en vez de pintar una vez, porque la lista dejó de ser dato de
 * build: un mantenedor que pausa un centro en Supabase tiene que alcanzar el
 * mapa de quien ya está mirando, no el próximo deploy. La primera llamada pinta
 * lo que el store ya tenga (nada, en arranque en frío) y la suscripción se
 * encarga desde la carga inicial en adelante.
 *
 * Acá también se decide de quién es cada punto. `map.ts` no puede preguntárselo
 * a la sesión —es dominio, no toca `data/`—, así que la respuesta baja como un
 * dato más, igual que `MarkerExtra` para los reportes.
 */
function paint(list: Centro[]): void {
  // Sin volver a pintar cuando cambia la sesión: `data/boot.ts` espera a
  // `restoreSession()` antes de `loadCentros()`, así que quien ya tenía sesión
  // llega con el `uid` puesto a la primera emisión. Quien entra por primera vez
  // la abre en paralelo con las consultas y todavía no tiene ningún punto
  // propio, así que no hay nada que pintar mal; un `addCentro` optimista es
  // todavía más tarde.
  setCentros(list.map((data) => ({ data, mine: isMine(data) })));
}

/**
 * Cada cuánto se vuelve a pintar sin que el store haya cambiado. Un punto
 * comunitario vence por reloj y no por evento: sin esto, la pestaña que quedó
 * abierta anoche sigue mostrando abierto a las nueve de la mañana un punto que
 * venció a las tres. Cinco minutos sobre un umbral de un día es error de
 * sobra, y repintar es barato — `setCentros` solo toca el marcador cuyo ícono
 * cambió de verdad.
 */
const REPAINT_MS = 5 * 60_000;

export function initCentrosLayer(): void {
  paint(getCentros());
  onCentros(paint);
  setInterval(() => paint(getCentros()), REPAINT_MS);
}
