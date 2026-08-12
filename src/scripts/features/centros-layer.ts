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
  // `initSession()` antes de `loadCentros()`, así que el `uid` ya está puesto en
  // la primera emisión y un `addCentro` optimista es todavía más tarde.
  setCentros(list.map((data) => ({ data, mine: isMine(data) })));
}

export function initCentrosLayer(): void {
  paint(getCentros());
  onCentros(paint);
}
