/**
 * Los popups de Leaflet se arman como string, así que todo lo que venga de la
 * red o de un formulario pasa por acá antes de entrar al HTML.
 */
export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c] as string,
  );
}

// Flecha de navegación, inline porque el popup se arma como string y no puede
// depender de un componente. `currentColor` hereda el texto del botón.
export const NAV_ICON = `<svg class="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M21.4 2.6a1 1 0 0 0-1.1-.2l-17 7.4a1 1 0 0 0 .1 1.9l7.1 2.1 2.1 7.1a1 1 0 0 0 1.9.1l7.4-17a1 1 0 0 0-.5-1.4Z"/></svg>`;

// El glifo de compartir —tres nodos y dos aristas—, el mismo dibujo en Android y
// en iOS. Va un punto más grande que `NAV_ICON` porque su botón no lleva texto al
// lado que le dé tamaño.
export const SHARE_ICON = `<svg class="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/></svg>`;

/**
 * Ruta en Google Maps hasta el punto exacto. Va por coordenadas y no por nombre
 * porque varias direcciones curadas son aproximadas ("Torre 2 piso 4") y una
 * búsqueda por texto aterrizaría en otra parte.
 */
export function directionsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
}
