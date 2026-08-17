import type {
  AnchorHTMLAttributes,
  ButtonHTMLAttributes,
  FC,
  HTMLAttributes,
} from "react";
import {
  instagramHandle,
  instagramUrl,
  isInstagramPostUrl,
  telUrl,
  whatsappUrl,
  whatsappUsernameUrl,
} from "@/lib/contact";
import { escapeHtml, INSTAGRAM_ICON, PHONE_ICON } from "@/scripts/ui/html";

export const CONTACT_CTA =
  "flex w-full text-center items-center justify-center gap-1.5 rounded-lg bg-emerald-600 p-4 text-sm font-semibold text-white no-underline shadow-sm transition hover:bg-emerald-700";

export const INSTAGRAM_CTA =
  "flex w-full text-center items-center justify-center gap-1.5 rounded-lg bg-linear-to-tr from-amber-500 via-pink-600 to-purple-600 p-4 text-sm font-semibold text-white no-underline shadow-sm transition hover:from-amber-600 hover:via-pink-700 hover:to-purple-700";

export const PhoneIcon: FC<{ className?: string }> = ({
  className = "h-4 w-4 shrink-0",
}) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="currentColor"
    aria-hidden="true"
  >
    <path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.24 11.4 11.4 0 0 0 3.6.58 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.46.58 3.6a1 1 0 0 1-.25 1l-2.23 2.2Z" />
  </svg>
);

export const InstagramIcon: FC<{ className?: string }> = ({
  className = "h-4 w-4 shrink-0",
}) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <rect x="3" y="3" width="18" height="18" rx="5" />
    <circle cx="12" cy="12" r="4" />
    <path d="M17.5 6.5v.01" />
  </svg>
);

export function contactHref(phone: string): { href: string; external: boolean } {
  const wa = whatsappUrl(phone);
  return { href: wa ?? telUrl(phone), external: wa !== null };
}

export function contactLabel(name: string, phone: string): string {
  return `${name} - ${phone}`;
}

export interface ContactCtaProps
  extends AnchorHTMLAttributes<HTMLAnchorElement> {
  name?: string;
  phone?: string;
  text?: string;
  username?: string;
  label?: string;
}

/**
 * Green CTA button linking to WhatsApp chat or direct telephone call.
 */
export const ContactCta: FC<ContactCtaProps> = ({
  name,
  phone,
  text,
  username,
  label,
  className = "",
  href,
  target,
  rel,
  children,
  ...rest
}) => {
  let resolvedHref = href;
  let isExternal = Boolean(target === "_blank");
  let displayLabel = label;

  if (!resolvedHref) {
    if (username) {
      resolvedHref = whatsappUsernameUrl(username, text);
      isExternal = true;
      displayLabel = displayLabel ?? "Escribir al WhatsApp";
    } else if (phone) {
      const { href: derivedHref, external } = contactHref(phone);
      resolvedHref = text ? (whatsappUrl(phone, text) ?? derivedHref) : derivedHref;
      isExternal = external;
      displayLabel =
        displayLabel ??
        (name
          ? contactLabel(name, phone)
          : external
            ? "Escribir al WhatsApp"
            : phone);
    }
  }

  const combinedClass = `${CONTACT_CTA} ${className}`.trim();

  return (
    <a
      href={resolvedHref}
      className={combinedClass}
      target={isExternal ? (target ?? "_blank") : target}
      rel={isExternal ? (rel ?? "noopener noreferrer") : rel}
      {...rest}
    >
      <PhoneIcon />
      <span>{children ?? displayLabel}</span>
    </a>
  );
};

export interface InstagramCtaProps
  extends AnchorHTMLAttributes<HTMLAnchorElement> {
  handle?: string;
  postUrl?: string;
  label?: string;
}

/**
 * Gradient CTA button linking to an Instagram profile or post.
 */
export const InstagramCta: FC<InstagramCtaProps> = ({
  handle,
  postUrl,
  label,
  className = "",
  href,
  children,
  ...rest
}) => {
  const resolvedHref =
    href ?? (postUrl ? postUrl : handle ? instagramUrl(handle) : "#");
  const displayLabel =
    label ??
    (postUrl ? "Ver publicación" : handle ? `@${instagramHandle(handle)}` : "");
  const combinedClass = `${INSTAGRAM_CTA} ${className}`.trim();

  return (
    <a
      href={resolvedHref}
      className={combinedClass}
      target="_blank"
      rel="noopener noreferrer"
      {...rest}
    >
      <InstagramIcon />
      <span>{children ?? displayLabel}</span>
    </a>
  );
};

export interface PendingContactCtaProps
  extends ButtonHTMLAttributes<HTMLButtonElement> {
  label?: string;
}

/**
 * Button placeholder shown while contact destination is resolving.
 */
export const PendingContactCta: FC<PendingContactCtaProps> = ({
  label = "Escribir al WhatsApp",
  className = "",
  children,
  ...rest
}) => {
  const combinedClass = `${CONTACT_CTA} ${className}`.trim();

  return (
    <button type="button" className={combinedClass} {...rest}>
      <PhoneIcon />
      <span>{children ?? label}</span>
    </button>
  );
};

export interface ContactLinksProps extends HTMLAttributes<HTMLDivElement> {
  whatsapp?: string;
  instagram?: string;
}

/**
 * Renders WhatsApp and Instagram anchor links.
 */
export const ContactLinks: FC<ContactLinksProps> = ({
  whatsapp,
  instagram,
  className = "",
  ...rest
}) => {
  if (!whatsapp && !instagram) return null;

  return (
    <div className={`flex flex-col gap-1 ${className}`.trim()} {...rest}>
      {whatsapp && (
        <a
          className="center-link text-sm font-medium"
          href={whatsappUrl(whatsapp) ?? telUrl(whatsapp)}
          target="_blank"
          rel="noopener noreferrer"
        >
          WhatsApp {whatsapp}
        </a>
      )}
      {instagram && (
        <a
          className="center-link text-sm font-medium"
          href={instagramUrl(instagram)}
          target="_blank"
          rel="noopener noreferrer"
        >
          @{instagramHandle(instagram)}
        </a>
      )}
    </div>
  );
};

export default ContactCta;

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
  label.textContent = isInstagramPostUrl(url) ? "Ver publicación" : "Ver perfil";

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

/** `instagram` paints the button the destination already deserves — the same
 *  gradient and icon `buildInstagramPostCta` ends up with — so what arrives
 *  replaces the placeholder without the label or the colour changing under the
 *  pointer. */
export function buildPendingCta(
  label = "Escribir al WhatsApp",
  instagram = false,
): HTMLButtonElement {
  const pending = document.createElement("button");
  pending.type = "button";
  pending.className = instagram ? INSTAGRAM_CTA : CONTACT_CTA;

  const icon = document.createElement("span");
  icon.className = "contents";
  icon.innerHTML = instagram ? INSTAGRAM_ICON : PHONE_ICON;

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
