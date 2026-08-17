import { useState, type ButtonHTMLAttributes, type FC, type HTMLAttributes } from "react";

export interface AccordionProps extends HTMLAttributes<HTMLElement> {
  /** Whether the card starts collapsed. Defaults to `true` to match the
   *  original `initAccordion` behaviour (sidebar opens on the map, not on
   *  all cards open at once). */
  defaultCollapsed?: boolean;
}

/**
 * Sidebar panel card that folds its `[data-card-body]` on desktop.
 *
 * Mirrors the behaviour of `ui/accordion.ts`: the card starts collapsed and
 * the `data-collapsed` attribute is toggled on click so the CSS rule in
 * `global.css` can show/hide the body. On mobile the media-query guard means
 * `data-collapsed` has no visual effect — the accordion is only an
 * `aria-expanded` announcement for screen readers.
 *
 * Render the toggle button as `<Accordion.Toggle>` and the collapsible
 * section as `<Accordion.Body>`.
 */
export const Accordion: FC<AccordionProps> & {
  Toggle: typeof AccordionToggle;
  Body: typeof AccordionBody;
  Caret: typeof AccordionCaret;
} = ({ defaultCollapsed = true, className = "", children, ...rest }) => {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  return (
    <section
      data-panel-card
      data-collapsed={String(collapsed)}
      className={className}
      {...rest}
    >
      {typeof children === "function"
        ? (children as (bag: AccordionBag) => React.ReactNode)({
            collapsed,
            toggle: () => setCollapsed((c) => !c),
          })
        : children}
    </section>
  );
};

export interface AccordionBag {
  collapsed: boolean;
  toggle: () => void;
}

export interface AccordionToggleProps
  extends ButtonHTMLAttributes<HTMLButtonElement> {
  collapsed: boolean;
  onToggle: () => void;
}

/**
 * Toggle button that controls the accordion open/close state.
 * Pass the `collapsed` and `onToggle` props from the parent's render bag.
 */
export const AccordionToggle: FC<AccordionToggleProps> = ({
  collapsed,
  onToggle,
  onClick,
  children,
  ...rest
}) => {
  return (
    <button
      type="button"
      aria-expanded={!collapsed}
      onClick={(e) => {
        onClick?.(e);
        onToggle();
      }}
      {...rest}
    >
      {children}
    </button>
  );
};

export interface AccordionBodyProps extends HTMLAttributes<HTMLDivElement> {}

/**
 * Collapsible body of the accordion. The `data-card-body` attribute is what
 * the CSS rule in `global.css` targets — do not remove it.
 */
export const AccordionBody: FC<AccordionBodyProps> = ({
  className = "",
  children,
  ...rest
}) => (
  <div data-card-body className={className} {...rest}>
    {children}
  </div>
);

export interface AccordionCaretProps extends HTMLAttributes<HTMLSpanElement> {
  collapsed: boolean;
}

/**
 * Visual caret that indicates the accordion direction.
 * `▴` when open, `▾` when collapsed — same characters as the original script.
 */
export const AccordionCaret: FC<AccordionCaretProps> = ({
  collapsed,
  className = "",
  ...rest
}) => (
  <span className={className} aria-hidden="true" {...rest}>
    {collapsed ? "▾" : "▴"}
  </span>
);

Accordion.Toggle = AccordionToggle;
Accordion.Body = AccordionBody;
Accordion.Caret = AccordionCaret;

export default Accordion;
