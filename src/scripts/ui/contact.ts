/**
 * Teléfonos de contacto. Son públicos por definición — quien los escribe está
 * pidiendo que lo llamen — así que acá no hay nada que ocultar: solo darles la
 * forma con la que se marcan y se abren en WhatsApp, y el botón con el que se
 * llaman.
 */

import { escapeHtml, PHONE_ICON } from "./html";

/** Mismo patrón que el CHECK de la base. Validar dos veces es a propósito. */
export const PHONE_PATTERN = /^[0-9+][0-9 ()+-]{6,19}$/;

export function isValidPhone(value: string): boolean {
  return PHONE_PATTERN.test(value.trim());
}

/**
 * Número en formato internacional para `wa.me`, que no acepta espacios ni
 * signos. Un celular colombiano se escribe casi siempre como «310 123 4567»,
 * sin indicativo: sin el 57 al frente WhatsApp abre un chat vacío.
 */
function toWhatsappDigits(phone: string): string | null {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10 && digits.startsWith("3")) return `57${digits}`;
  if (digits.length === 12 && digits.startsWith("57")) return digits;
  // Fijos de Cali (602 + 7 dígitos) y cualquier otra cosa: no se asume nada.
  return digits.length >= 7 ? digits : null;
}

export function whatsappUrl(phone: string): string | null {
  const digits = toWhatsappDigits(phone);
  return digits ? `https://wa.me/${digits}` : null;
}

export function telUrl(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}

/* ---- El botón de llamar, en las dos formas en que se arma ---- */

/**
 * El CTA verde: icono de auricular y «nombre - teléfono». Estaba escrito a mano
 * en tres lados —el popup del mapa, la lista de reportes y la de ofertas— y ya
 * se había desalineado una vez. Como el popup se arma como string y los paneles
 * como elementos, lo compartido son las clases y dos constructores, igual que
 * `select.ts`. Las clases van literales: el escáner de Tailwind lee este archivo
 * como texto plano.
 *
 * Sin margen a propósito: el popup y las ofertas lo separan con `mt-2`, la lista
 * con el `gap` de su contenedor. El espacio lo pone quien lo coloca.
 */
export const CONTACT_CTA =
  "flex w-full text-center items-center justify-center gap-1.5 rounded-lg bg-emerald-600 p-3 text-sm font-semibold text-white no-underline shadow-sm transition hover:bg-emerald-700";

/** A dónde va el botón: al chat si el número lo arma, si no a marcarlo. */
function contactHref(phone: string): { href: string; external: boolean } {
  const wa = whatsappUrl(phone);
  return { href: wa ?? telUrl(phone), external: wa !== null };
}

/** El texto del botón: por quién preguntar y a qué número. */
function contactLabel(name: string, phone: string): string {
  return `${name} - ${phone}`;
}

/**
 * El CTA como string, para el popup del mapa. Lleva `centro-cta` además de las
 * clases: Leaflet pinta de azul todo `a` dentro del mapa y esa clase es la que
 * recupera el blanco (`global.css`), tanto en el popup como en el sheet.
 */
export function contactCtaHtml(
  name: string,
  phone: string,
  extra = "",
): string {
  const { href, external } = contactHref(phone);
  // El margen va en el propio `a` y no en un envoltorio: el sheet móvil anula
  // el margen de `a.centro-cta` para repartir el aire con su `gap`, y una capa
  // de por medio le escondería el elemento a esa regla.
  return `<a
      class="centro-cta ${extra} ${CONTACT_CTA}"
      href="${escapeHtml(href)}"
      ${external ? 'target="_blank" rel="noopener noreferrer"' : ""}
    >${PHONE_ICON}<span>${escapeHtml(contactLabel(name, phone))}</span></a>`;
}

/** El mismo CTA como elemento, para los paneles que arman DOM. */
export function buildContactCta(name: string, phone: string): HTMLAnchorElement {
  const { href, external } = contactHref(phone);
  const call = document.createElement("a");
  call.className = CONTACT_CTA;
  call.href = href;
  if (external) {
    call.target = "_blank";
    call.rel = "noopener noreferrer";
  }

  const icon = document.createElement("span");
  icon.className = "contents";
  icon.innerHTML = PHONE_ICON;

  const who = document.createElement("span");
  who.textContent = contactLabel(name, phone);

  call.append(icon, who);
  return call;
}
