import { renderToStaticMarkup } from "react-dom/server";
import { isCommunity, isExpired, type Center } from "@/scripts/centers";
import { byCategory } from "@/scripts/resources";
import { chipStyle } from "@/components/ui/ResourceChip";
import { ContactLinks } from "@/components/ui/ContactCta";
import { directionsUrl, linkifyHtml } from "@/scripts/ui/html";
import { relativeTime } from "@/scripts/ui/time";

export const CENTER_POPUP_KICKER: Record<
  Center["type"],
  { label: string; color: string; accent: string }
> = {
  acopio: {
    label: "Centro de acopio",
    color: "text-indigo-700",
    accent: "#4338ca",
  },
  albergue: {
    label: "Albergue",
    color: "text-amber-700",
    accent: "#b45309",
  },
  sangre: {
    label: "Banco de sangre",
    color: "text-rose-700",
    accent: "#be123c",
  },
  healthcare: {
    label: "Atención en salud",
    color: "text-blue-700",
    accent: "#1d4ed8",
  },
  municipio: {
    label: "Municipio que pide ayuda",
    color: "text-red-800",
    accent: "#991b1b",
  },
};

export const CENTER_POPUP_ORIGIN: Record<Center["origin"], string> = {
  curado: "Creado por la alcaldía",
  comunidad: "Creado por la comunidad",
};

export function centerPopupChipsTitle(center: Center): string {
  return center.type === "municipio" ? "Necesita" : "Recibe";
}

type CenterPopupProps = {
  center: Center;
  mine: boolean;
  shareButtonHtml: string;
};

function CenterPopup({ center, mine, shareButtonHtml }: CenterPopupProps) {
  const paused = !center.isActive || isExpired(center);
  const expired = center.isActive && isExpired(center);
  const { label, color } = CENTER_POPUP_KICKER[center.type];
  const kickerLabel = expired
    ? `${label} · Sin confirmar`
    : paused
      ? `${label} · Cerrado por ahora`
      : label;
  const notAcceptingLabel =
    center.type === "sangre"
      ? "No recibe donantes por ahora"
      : "No recibe donaciones por ahora";
  const ctaClass = paused
    ? "center-cta center-cta-quiet flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-4 py-2 text-md font-semibold no-underline transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-slate-300"
    : "center-cta flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-md font-semibold no-underline shadow-sm transition hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-300";
  const donationGroups = byCategory(center.donations, (item) => item);

  return (
    <div className="space-y-6!">
      <div className="space-y-1!">
        <p
          className={`text-xs font-semibold uppercase tracking-wide ${paused ? "text-slate-500" : color}`}
        >
          {kickerLabel}
        </p>
        <p className="text-lg font-semibold leading-tight text-slate-900 mt-3">
          {center.name}
        </p>
        <p className="text-sm text-slate-500">
          {CENTER_POPUP_ORIGIN[center.origin]}
        </p>
        <p data-address className="text-xs text-slate-600">
          {center.address}
        </p>
      </div>
      {expired ? (
        <p
          className="text-xs font-medium text-amber-700"
          data-time={center.updatedAt}
          data-time-prefix="Nadie confirma este punto desde "
        >
          Nadie confirma este punto desde {relativeTime(center.updatedAt)}
        </p>
      ) : paused ? (
        <p className="text-xs font-medium text-amber-700">Cerrado por ahora</p>
      ) : null}
      {!center.acceptingDonations && (
        <p className="text-xs font-medium text-amber-700">
          {notAcceptingLabel}
        </p>
      )}
      <p className="text-xs text-slate-600">{center.hours}</p>
      {donationGroups.length > 0 && (
        <div className="space-y-5!">
          <p className="text-xs m-0 font-semibold uppercase tracking-wide text-slate-500">
            {centerPopupChipsTitle(center)}
          </p>
          {donationGroups.map((bucket) => (
            <div key={bucket.label}>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                {bucket.label}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {bucket.items.map((item) => (
                  <span
                    key={item}
                    className={`inline-block ${chipStyle(item, paused)}`}
                  >
                    {item}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      <ContactLinks
        whatsapp={center.contactWhatsapp}
        instagram={center.contactInstagram}
      />
      {center.notes &&
        (isCommunity(center) ? (
          <p className="text-sm wrap-break-word text-slate-500">
            {center.notes}
          </p>
        ) : (
          <p
            className="text-sm wrap-break-word text-slate-500"
            dangerouslySetInnerHTML={{ __html: linkifyHtml(center.notes) }}
          />
        ))}
      <div className="mt-1 flex items-stretch gap-2">
        <a
          className={ctaClass}
          href={directionsUrl(center.lat, center.lng)}
          target="_blank"
          rel="noopener noreferrer"
        >
          <svg
            className="h-3.5 w-3.5 shrink-0"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M21.4 2.6a1 1 0 0 0-1.1-.2l-17 7.4a1 1 0 0 0 .1 1.9l7.1 2.1 2.1 7.1a1 1 0 0 0 1.9.1l7.4-17a1 1 0 0 0-.5-1.4Z" />
          </svg>
          Cómo llegar
        </a>
        <div dangerouslySetInnerHTML={{ __html: shareButtonHtml }} />
      </div>
      {expired && (
        <button
          type="button"
          data-confirm-center={center.id}
          className="mt-2 w-full rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-800 transition hover:bg-amber-100 focus:outline-none focus:ring-2 focus:ring-amber-300"
        >
          Sigue abierto
        </button>
      )}
      {mine && isCommunity(center) && (
        <button
          type="button"
          data-delete-center={center.id}
          data-point-name={center.name}
          className="mt-1 w-full text-xs font-medium text-slate-400 transition hover:text-red-600"
        >
          Eliminar este punto
        </button>
      )}
    </div>
  );
}

export function renderCenterPopup(props: CenterPopupProps): string {
  return renderToStaticMarkup(<CenterPopup {...props} />);
}

export default CenterPopup;
