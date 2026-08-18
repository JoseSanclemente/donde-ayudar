import { renderToStaticMarkup } from "react-dom/server";
import type { ReportGroup } from "@/scripts/cluster";
import { byCategory } from "@/scripts/resources";
import { ContactCta } from "@/components/ui/ContactCta";
import { ResourceChip } from "@/components/ui/ResourceChip";
import { relativeTime } from "@/scripts/ui/time";

type ReportPopupProps = {
  group: ReportGroup;
  freshAt: string;
  lastUpdate?: string;
  lastUpdateAt?: string;
  stale: boolean;
  statusSelectHtml: string;
  shareButtonHtml: string;
};

function ReportPopup({
  group,
  freshAt,
  lastUpdate,
  lastUpdateAt,
  stale,
  statusSelectHtml,
  shareButtonHtml,
}: ReportPopupProps) {
  const { lead } = group;
  const date = new Date(lead.createdAt).toLocaleString("es-CO", {
    dateStyle: "medium",
    timeStyle: "short",
  });
  const notes = group.reports
    .filter((report) => report.note)
    .slice(0, 2)
    .map((report) => ({
      body: report.note as string,
      createdAt: report.createdAt,
    }));
  const updates = [
    ...notes,
    ...(lastUpdate
      ? [{ body: lastUpdate, createdAt: lastUpdateAt ?? freshAt }]
      : []),
  ]
    .filter(
      (update, index, entries) =>
        entries.findIndex((entry) => entry.body === update.body) === index,
    )
    .reverse();
  const contacts = group.reports
    .filter((report) => report.contactName)
    .slice(0, 2);
  const resourceGroups = byCategory(
    group.resources,
    (resource) => resource.name,
  );

  return (
    <div className="space-y-6">
      <div dangerouslySetInnerHTML={{ __html: statusSelectHtml }} />
      <p
        className={`text-xs ${stale ? "font-medium text-amber-700" : "text-slate-500"}`}
      >
        Actualizado {relativeTime(freshAt)}
        {stale ? " — confirma antes de ir" : ""}
      </p>

      <div className="space-y-1 mt-3">
        {lead.placeName && (
          <p className="text-base text-slate-600">{lead.placeName}</p>
        )}
        <p className="text-lg font-semibold text-slate-900">{lead.name}</p>
      </div>

      {group.reports.length > 1 && (
        <p className="text-xs text-slate-500">
          {group.reports.length} reportes en este punto
        </p>
      )}
      <div className="space-y-2">
        {resourceGroups.length === 0 ? (
          <p className="text-sm text-slate-500">
            Todavía no dice qué necesita.
          </p>
        ) : (
          resourceGroups.map((bucket) => (
            <div key={bucket.label}>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                {bucket.label}
              </p>
              <div className="mt-1 flex flex-wrap gap-1">
                {bucket.items.map((resource) => (
                  <ResourceChip key={resource.name} resource={resource} />
                ))}
              </div>
            </div>
          ))
        )}
      </div>
      {group.resources.length > 0 && group.pending === 0 && (
        <p className="text-xs font-medium text-emerald-700">
          Necesidades cubiertas
        </p>
      )}
      {updates.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-bold uppercase tracking-wide text-black">
            Últimas actualizaciones
          </p>
          <ul className="divide-y divide-slate-200 mt-2">
            {updates.map((update) => (
              <li
                key={`${update.createdAt}:${update.body}`}
                className="py-3 first:pt-0 last:pb-0 text-sm leading-snug text-slate-600"
              >
                <p>{update.body}</p>
                <p className="text-xs mt-1! text-slate-400">
                  Publicado {relativeTime(update.createdAt)}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}
      {contacts.map((report) =>
        report.contactPhone ? (
          <ContactCta
            key={report.id}
            name={report.contactName ?? undefined}
            phone={report.contactPhone}
            className="center-cta mt-2"
          />
        ) : (
          <p key={report.id} className="text-sm text-slate-600">
            Contacto: {report.contactName}
          </p>
        ),
      )}
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-slate-400">Reportado el {date}</p>
        <div dangerouslySetInnerHTML={{ __html: shareButtonHtml }} />
      </div>
    </div>
  );
}

export function renderReportPopup(props: ReportPopupProps): string {
  return renderToStaticMarkup(<ReportPopup {...props} />);
}

export default ReportPopup;
