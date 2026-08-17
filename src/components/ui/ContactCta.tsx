import type {
  AnchorHTMLAttributes,
  ButtonHTMLAttributes,
  FC,
  HTMLAttributes,
} from "react";
import {
  instagramHandle,
  instagramUrl,
  telUrl,
  whatsappUrl,
  whatsappUsernameUrl,
} from "@/lib/contact";

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
