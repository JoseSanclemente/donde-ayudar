/**
 * Teléfonos de contacto. Son públicos por definición — quien los escribe está
 * pidiendo que lo llamen — así que acá no hay nada que ocultar: solo darles la
 * forma con la que se marcan y se abren en WhatsApp, y el botón con el que se
 * llaman.
 */

import { escapeHtml, INSTAGRAM_ICON, PHONE_ICON } from "./html";

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

/* ---- Usuarios de WhatsApp ---- */

/**
 * Un usuario de WhatsApp, que es el contacto de quien esconde su número detrás
 * de uno. `wa.me` lo resuelve igual que a un número —contesta con un enlace
 * `type=username`— así que el botón es el mismo y solo cambia lo que va después
 * de la barra. Sin `tel:` de repuesto: acá no hay nada que marcar.
 *
 * Mismo alfabeto que el CHECK de la base. Validar dos veces es a propósito.
 */
export const WHATSAPP_USERNAME_PATTERN = /^[A-Za-z0-9._-]{3,30}$/;

export function isValidWhatsappUsername(value: string): boolean {
  return WHATSAPP_USERNAME_PATTERN.test(value.trim());
}

export function whatsappUsernameUrl(username: string): string {
  return `https://wa.me/${encodeURIComponent(username.trim())}`;
}

/* ---- Instagram ---- */

/** Same pattern Instagram itself accepts, minus the `@` nobody stores. */
export const INSTAGRAM_PATTERN = /^[A-Za-z0-9._]{1,30}$/;

/** Whatever the visitor typed — `@name`, a url — down to the handle. */
export function instagramHandle(value: string): string {
  return value
    .trim()
    .replace(/^https?:\/\/(www\.)?instagram\.com\//i, "")
    .replace(/^@/, "")
    .replace(/\/.*$/, "");
}

export function isValidInstagram(value: string): boolean {
  return INSTAGRAM_PATTERN.test(instagramHandle(value));
}

export function instagramUrl(handle: string): string {
  return `https://instagram.com/${instagramHandle(handle)}`;
}

/**
 * The two contact lines of a center, as links: the chat and the profile. A
 * phone written down as dead text is no use to whoever is reading it on a
 * phone, which is where this site is read.
 */
export function contactLinksHtml(
  whatsapp?: string,
  instagram?: string,
): string {
  const lines = [
    whatsapp
      ? `<a class="center-link text-sm font-medium" href="${escapeHtml(
          whatsappUrl(whatsapp) ?? telUrl(whatsapp),
        )}" target="_blank" rel="noopener noreferrer">WhatsApp ${escapeHtml(whatsapp)}</a>`
      : "",
    instagram
      ? `<a class="center-link text-sm font-medium" href="${escapeHtml(
          instagramUrl(instagram),
        )}" target="_blank" rel="noopener noreferrer">@${escapeHtml(instagramHandle(instagram))}</a>`
      : "",
  ].filter(Boolean);
  if (lines.length === 0) return "";
  return `<div class="flex flex-col gap-1">${lines.join("")}</div>`;
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
  "flex w-full text-center items-center justify-center gap-1.5 rounded-lg bg-emerald-600 p-4 text-sm font-semibold text-white no-underline shadow-sm transition hover:bg-emerald-700";

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
 * El CTA como string, para el popup del mapa. Lleva `center-cta` además de las
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
  // el margen de `a.center-cta` para repartir el aire con su `gap`, y una capa
  // de por medio le escondería el elemento a esa regla.
  return `<a
      class="center-cta ${extra} ${CONTACT_CTA}"
      href="${escapeHtml(href)}"
      ${external ? 'target="_blank" rel="noopener noreferrer"' : ""}
    >${PHONE_ICON}<span>${escapeHtml(contactLabel(name, phone))}</span></a>`;
}

/**
 * El gemelo del CTA verde para quien deja un Instagram en vez de un teléfono.
 * Mismas clases, otro color: dos botones idénticos en la misma ficha no dirían
 * a cuál app abre cada uno. Van literales por lo mismo que `CONTACT_CTA`.
 *
 * Sin variante de string: hoy nadie arma este botón como HTML — el popup del
 * mapa sigue con `contactLinksHtml`.
 */
export const INSTAGRAM_CTA =
  "flex w-full text-center items-center justify-center gap-1.5 rounded-lg bg-fuchsia-600 p-3 text-sm font-semibold text-white no-underline shadow-sm transition hover:bg-fuchsia-700";

export function buildInstagramCta(handle: string): HTMLAnchorElement {
  const profile = document.createElement("a");
  profile.className = INSTAGRAM_CTA;
  profile.href = instagramUrl(handle);
  profile.target = "_blank";
  profile.rel = "noopener noreferrer";

  const icon = document.createElement("span");
  icon.className = "contents";
  icon.innerHTML = INSTAGRAM_ICON;

  const who = document.createElement("span");
  who.textContent = `@${instagramHandle(handle)}`;

  profile.append(icon, who);
  return profile;
}

/**
 * El CTA de una mascota encontrada, que no trae nombre: quien escribe pregunta
 * por el animal, no por una persona. Dice a dónde lleva y no qué número es —el
 * número es un dato que nadie va a marcar a mano desde el celular— salvo cuando
 * no se puede armar el chat, que ahí el botón marca y lo honesto es mostrarlo.
 */
export function buildPhoneCta(phone: string): HTMLAnchorElement {
  const { href, external } = contactHref(phone);
  return buildCta(href, external, external ? "Escribir al WhatsApp" : phone);
}

/**
 * El mismo botón para quien escribió desde un usuario de WhatsApp y no desde un
 * número. Dice lo mismo porque hace lo mismo: abre ese chat. El usuario no se
 * pinta —no es un dato que nadie vaya a copiar— y no hay variante de marcar,
 * que es la diferencia entera con el de arriba.
 */
export function buildUsernameCta(username: string): HTMLAnchorElement {
  return buildCta(whatsappUsernameUrl(username), true, "Escribir al WhatsApp");
}

function buildCta(
  href: string,
  external: boolean,
  label: string,
): HTMLAnchorElement {
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
  who.textContent = label;

  call.append(icon, who);
  return call;
}

/** El mismo CTA como elemento, para los paneles que arman DOM. */
export function buildContactCta(
  name: string,
  phone: string,
): HTMLAnchorElement {
  const call = buildPhoneCta(phone);
  // El botón ya está armado: lo único que cambia es por quién preguntar.
  const who = call.lastElementChild as HTMLSpanElement;
  who.textContent = contactLabel(name, phone);
  return call;
}
