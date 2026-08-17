import type { FC, HTMLAttributes } from "react";

export const NEW_DOT = "new-dot h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400";

export interface NewDotProps extends HTMLAttributes<HTMLSpanElement> {
  label?: string;
}

/**
 * Pulsing amber dot indicator for new items.
 */
export const NewDot: FC<NewDotProps> = ({
  label,
  className = "",
  hidden,
  ...rest
}) => {
  const combinedClass = `${NEW_DOT} ${className}`.trim();

  return (
    <span
      className={combinedClass}
      hidden={hidden}
      aria-hidden={label ? undefined : true}
      {...rest}
    >
      {label && <span className="sr-only">{label}</span>}
    </span>
  );
};

export default NewDot;

/**
 * Builds an HTMLSpanElement for imperative DOM rendering.
 */
export function buildNewDot(extra = "", label = ""): HTMLSpanElement {
  const dot = document.createElement("span");
  dot.className = `${NEW_DOT} ${extra}`.trim();
  if (label) {
    const text = document.createElement("span");
    text.className = "sr-only";
    text.textContent = label;
    dot.append(text);
  } else {
    dot.setAttribute("aria-hidden", "true");
  }
  return dot;
}
