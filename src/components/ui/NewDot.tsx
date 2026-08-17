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
