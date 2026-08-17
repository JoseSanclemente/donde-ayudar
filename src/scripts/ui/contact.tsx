import { escapeHtml, INSTAGRAM_ICON, PHONE_ICON } from "@/scripts/ui/html";
import {
  instagramHandle,
  instagramUrl,
  isValidInstagram,
  isValidPhone,
  isValidWhatsappUsername,
  PHONE_PATTERN,
  telUrl,
  toWhatsappDigits,
  whatsappUrl,
  whatsappUsernameUrl,
  WHATSAPP_USERNAME_PATTERN,
  INSTAGRAM_PATTERN,
} from "@/lib/contact";
import {
  CONTACT_CTA,
  contactHref,
  contactLabel,
  ContactCta,
  ContactLinks,
  InstagramCta,
  INSTAGRAM_CTA,
  InstagramIcon,
  PendingContactCta,
  PhoneIcon,
  type ContactCtaProps,
  type ContactLinksProps,
  type InstagramCtaProps,
  type PendingContactCtaProps,
} from "@/components/ui/ContactCta";

export {
  PHONE_PATTERN,
  isValidPhone,
  toWhatsappDigits,
  whatsappUrl,
  telUrl,
  WHATSAPP_USERNAME_PATTERN,
  isValidWhatsappUsername,
  whatsappUsernameUrl,
  INSTAGRAM_PATTERN,
  instagramHandle,
  isValidInstagram,
  instagramUrl,
  CONTACT_CTA,
  INSTAGRAM_CTA,
  PhoneIcon,
  InstagramIcon,
  ContactCta,
  InstagramCta,
  PendingContactCta,
  ContactLinks,
  type ContactCtaProps,
  type InstagramCtaProps,
  type PendingContactCtaProps,
  type ContactLinksProps,
};

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

export function contactCtaHtml(
  name: string,
  phone: string,
  extra = "",
): string {
  const { href, external } = contactHref(phone);

  return `<a
      class="center-cta ${extra} ${CONTACT_CTA}"
      href="${escapeHtml(href)}"
      ${external ? 'target="_blank" rel="noopener noreferrer"' : ""}
    >${PHONE_ICON}<span>${escapeHtml(contactLabel(name, phone))}</span></a>`;
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

export function buildInstagramPostCta(url: string): HTMLAnchorElement {
  const post = document.createElement("a");
  post.className = INSTAGRAM_CTA;
  post.href = url;
  post.target = "_blank";
  post.rel = "noopener noreferrer";

  const icon = document.createElement("span");
  icon.className = "contents";
  icon.innerHTML = INSTAGRAM_ICON;

  const label = document.createElement("span");
  label.textContent = "Ver publicación";

  post.append(icon, label);
  return post;
}

export function buildPhoneCta(phone: string, text?: string): HTMLAnchorElement {
  const wa = whatsappUrl(phone, text);
  return wa
    ? buildCta(wa, true, "Escribir al WhatsApp")
    : buildCta(telUrl(phone), false, phone);
}

export function buildUsernameCta(
  username: string,
  text?: string,
): HTMLAnchorElement {
  return buildCta(
    whatsappUsernameUrl(username, text),
    true,
    "Escribir al WhatsApp",
  );
}

export function buildPendingCta(
  label = "Escribir al WhatsApp",
): HTMLButtonElement {
  const pending = document.createElement("button");
  pending.type = "button";
  pending.className = CONTACT_CTA;

  const icon = document.createElement("span");
  icon.className = "contents";
  icon.innerHTML = PHONE_ICON;

  const who = document.createElement("span");
  who.textContent = label;

  pending.append(icon, who);
  return pending;
}

export function buildContactCta(
  name: string,
  phone: string,
): HTMLAnchorElement {
  const call = buildPhoneCta(phone);
  const who = call.lastElementChild as HTMLSpanElement;
  who.textContent = contactLabel(name, phone);
  return call;
}
