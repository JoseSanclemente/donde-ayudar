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




const URL_PATTERN = /https?:\/\/[^\s<>"']+/g;
const TRAILING_PUNCTUATION = /[.,;:!?)\]]+$/;


const LINK_TEXT_MAX = 40;

/**
 * Un texto libre con sus URLs vueltas enlaces. Escapa todo —los tramos de texto
 * y la URL— antes de armar el HTML, así que sirve para lo mismo que
 * `escapeHtml`: lo que viene de la red o de un formulario.
 *
 * Quién decide si un texto merece enlaces no se resuelve acá: `ui/` no sabe de
 * dominio. Hoy `map.ts` lo llama solo sobre un punto curado.
 */
export function linkifyHtml(value: string): string {
  let out = "";
  let last = 0;
  for (const match of value.matchAll(URL_PATTERN)) {
    const start = match.index;
    const raw = match[0];
    const url = raw.replace(TRAILING_PUNCTUATION, "");
    out += escapeHtml(value.slice(last, start));
    
    
    out += `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" class="center-link break-all">${escapeHtml(elide(url))}</a>`;
    last = start + url.length;
  }
  return out + escapeHtml(value.slice(last));
}

/**
 * El mismo texto sin URLs, cada una reducida a su host. Para la tarjeta de
 * compartir: un enlace en un PNG no se puede tocar, y `wrap()` deja pasar una
 * palabra más ancha que la caja, así que la URL cruda se sale del dibujo.
 */
export function stripUrls(value: string): string {
  return value
    .replace(URL_PATTERN, (raw) => hostOf(raw.replace(TRAILING_PUNCTUATION, "")))
    .replace(/\s+/g, " ")
    .trim();
}

function elide(url: string): string {
  return url.length <= LINK_TEXT_MAX
    ? url
    : `${url.slice(0, LINK_TEXT_MAX - 1)}…`;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}



export const NAV_ICON = `<svg class="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M21.4 2.6a1 1 0 0 0-1.1-.2l-17 7.4a1 1 0 0 0 .1 1.9l7.1 2.1 2.1 7.1a1 1 0 0 0 1.9.1l7.4-17a1 1 0 0 0-.5-1.4Z"/></svg>`;




export const SHARE_ICON = `<svg class="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/></svg>`;



export const PHONE_ICON = `<svg class="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.24 11.4 11.4 0 0 0 3.6.58 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.46.58 3.6a1 1 0 0 1-.25 1l-2.23 2.2Z"/></svg>`;



export const INSTAGRAM_ICON = `<svg class="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><path d="M17.5 6.5v.01"/></svg>`;

/**
 * Ruta en Google Maps hasta el punto exacto. Va por coordenadas y no por nombre
 * porque varias direcciones curadas son aproximadas ("Torre 2 piso 4") y una
 * búsqueda por texto aterrizaría en otra parte.
 */
export function directionsUrl(lat: number, lng: number): string {
  return `https:
}
