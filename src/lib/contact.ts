export const PHONE_PATTERN = /^[0-9+][0-9 ()+-]{6,19}$/;

export function isValidPhone(value: string): boolean {
  return PHONE_PATTERN.test(value.trim());
}

export function toWhatsappDigits(phone: string): string | null {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10 && digits.startsWith("3")) return `57${digits}`;
  if (digits.length === 12 && digits.startsWith("57")) return digits;
  return digits.length >= 7 ? digits : null;
}

function withText(url: string, text?: string): string {
  return text ? `${url}?text=${encodeURIComponent(text)}` : url;
}

export function whatsappUrl(phone: string, text?: string): string | null {
  const digits = toWhatsappDigits(phone);
  return digits ? withText(`https://wa.me/${digits}`, text) : null;
}

export function telUrl(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}

export const WHATSAPP_USERNAME_PATTERN = /^[A-Za-z0-9._-]{3,30}$/;

export function isValidWhatsappUsername(value: string): boolean {
  return WHATSAPP_USERNAME_PATTERN.test(value.trim());
}

export function whatsappUsernameUrl(username: string, text?: string): string {
  return withText(`https://wa.me/${encodeURIComponent(username.trim())}`, text);
}

export const INSTAGRAM_PATTERN = /^[A-Za-z0-9._]{1,30}$/;

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

export const INSTAGRAM_POST_URL_PATTERN =
  /^https?:\/\/(www\.)?instagram\.com\/(p|reel)\/[A-Za-z0-9_-]{5,30}\/?$/;

export function isInstagramPostUrl(value: string): boolean {
  return INSTAGRAM_POST_URL_PATTERN.test(value.trim());
}
