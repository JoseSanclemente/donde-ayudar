/**
 * Teléfonos de contacto. Son públicos por definición — quien los escribe está
 * pidiendo que lo llamen — así que acá no hay nada que ocultar: solo darles la
 * forma con la que se marcan y se abren en WhatsApp.
 */

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
