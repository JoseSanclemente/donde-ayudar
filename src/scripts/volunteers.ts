/**
 * The panels where someone signs up to help with their own time: mental health
 * companionship, free legal advice. They are one shape — a name, a WhatsApp or
 * an Instagram, a note — and one table, told apart by `kind`.
 *
 * This is the only place a new panel is declared: the markup loops over this
 * list to build its tab button and its card, and `features/volunteer-panel.ts`
 * loops over it to wire them. Adding one is adding an entry, plus its `kind` to
 * the CHECK in the database.
 */
export type VolunteerKind = "salud_mental" | "juridica";

export type VolunteerPanel = {
  kind: VolunteerKind;
  /** Id prefix of every element of the panel: `mental-form`, `legal-form`… */
  prefix: string;
  /** The `data-tab-btn` and `data-tab-panel` value of the mobile sheet. */
  tab: string;
  tabLabel: string;
  /**
   * The tab icon: one `<path>` and, at most, one direct-child `<circle>` for its
   * hole. The selected tab is painted by filling everything that is not a
   * `circle` (`global.css`), so a second path would disappear into the
   * silhouette — several subpaths inside the same `d` are fine.
   */
  icon: { path: string; circle?: { cx: number; cy: number; r: number } };
  title: string;
  /** What the accordion button announces on desktop. */
  toggleLabel: string;
  notesPlaceholder: string;
  listTitle: string;
  emptyLabel: string;
};

export const VOLUNTEER_PANELS: VolunteerPanel[] = [
  {
    kind: "salud_mental",
    prefix: "mental",
    tab: "salud",
    tabLabel: "Salud mental",
    icon: {
      path: "M12.2 17.4v-2.6h1.9c.6 0 1-.5.9-1.1l-.4-2.3c1-2.6-.2-5.5-2.8-6.7C9.1 3.4 6 4.5 4.7 7.1a5.6 5.6 0 001.4 6.8v3.5h6.1z",
      circle: { cx: 9, cy: 9.6, r: 1.9 },
    },
    title: "¿Quieres apoyar a la comunidad?",
    toggleLabel: "Mostrar u ocultar las inscripciones",
    notesPlaceholder:
      "Cómo puedes apoyar y en qué horarios. Ej: psicóloga, tardes entre semana.",
    listTitle: "Personas inscritas",
    emptyLabel: "Todavía nadie se ha inscrito.",
  },
  {
    kind: "juridica",
    prefix: "legal",
    tab: "juridico",
    tabLabel: "Jurídica",
    icon: {
      // Scales, drawn as closed subpaths and not as a line: the selected tab
      // fills the icon, and an outlined balance came out a blob.
      path: "M9.3 4.2h1.4v10.4H9.3zM3.9 6.1h12.2v1.3H3.9zM5.6 15.4h8.8l.9 1.9H4.7zM2.1 12.3h5.1L4.65 7.6zM12.8 12.3h5.1L15.35 7.6z",
    },
    title: "¿Puedes dar asesoría jurídica?",
    toggleLabel: "Mostrar u ocultar las inscripciones de asesoría jurídica",
    notesPlaceholder:
      "En qué puedes asesorar y en qué horarios. Ej: abogada laboralista, tardes.",
    listTitle: "Personas inscritas",
    emptyLabel: "Todavía nadie se ha inscrito.",
  },
];
